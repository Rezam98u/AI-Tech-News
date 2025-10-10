import cron from 'node-cron';
import { Telegraf, Markup } from 'telegraf';
import { logger } from '../logger';
import { counters } from '../metrics';
import { fetchAllArticles, validateRedditLink } from '../data-aggregator';
import { filterNewArticles, markArticlesPosted } from '../storage';
import { filterArticlesByCategory, ContentCategory } from '../categorizer';
import { sendPostWithImage } from '../services/post-service';
import { Article } from '../types';

interface PendingPost {
	article: Article;
	message: string;
	timestamp: number;
}

const pendingPosts = new Map<string, PendingPost>();

export class SchedulerService {
	private isSchedulerRunning = false;
	private bot?: Telegraf;
	private previewMode: boolean = true;

	setBot(bot: Telegraf): void {
		this.bot = bot;
	}

	setPreviewMode(enabled: boolean): void {
		this.previewMode = enabled;
		logger.info({ previewMode: enabled }, 'Preview mode updated');
	}

	isPreviewMode(): boolean {
		return this.previewMode;
	}

	startScheduler(): void {
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			logger.warn('TELEGRAM_TARGET_CHAT_ID not set; scheduler will not post');
		}

		cron.schedule('*/90 * * * * *', async () => {
			counters.cronRuns.inc();
			
			if (this.isSchedulerRunning) {
				logger.debug('Scheduler already running, skipping this iteration');
				return;
			}

			this.isSchedulerRunning = true;
			
			try {
				await this.processArticles();
			} catch (err) {
				logger.error({ err }, 'Scheduler iteration failed');
			} finally {
				this.isSchedulerRunning = false;
			}
		});

		logger.info({
			autoPostingEnabled: this.isAutoPostingEnabled(),
			note: 'Automatic posting is disabled by default for safety'
		}, 'Article scheduler started');
	}

	private isAutoPostingEnabled(): boolean {
		const autoPostingEnabled = process.env.AUTO_POSTING_ENABLED === 'true';
		return autoPostingEnabled;
	}

	private async processArticles(): Promise<void> {
		try {
			const cleanedCount = this.cleanupOldPendingPosts();
			if (cleanedCount > 0) {
				logger.info({ cleanedCount }, 'Cleaned up expired pending posts');
			}

			if (!this.isAutoPostingEnabled()) {
				logger.debug('scheduler: automatic posting is disabled');
				return;
			}

			const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
			
			// Exclude Reddit feeds from auto-posting (they use interactive browser)
			const excludeReddit = process.env.REDDIT_AUTO_FETCH !== 'true';
			const articles = await fetchAllArticles(undefined, { maxAgeHours: 48, excludeReddit });
			articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			const newOnes = await filterNewArticles(articles, { maxAgeHours: 48 });
			newOnes.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			logger.debug({ 
				totalArticles: articles.length,
				newArticles: newOnes.length,
				hasTargetChat: !!targetChat,
				newestDate: articles[0]?.pubDate
			}, 'scheduler: fetched and filtered articles');
			
			if (!targetChat || newOnes.length === 0) {
				if (!targetChat) {
					logger.debug('scheduler: no target chat configured');
				} else {
					logger.debug('scheduler: no new articles to post');
				}
				return;
			}
			
			const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
			const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
			
			categorizedArticles.sort((a, b) => {
			const aAge = Date.now() - new Date(a.pubDate).getTime();
			const bAge = Date.now() - new Date(b.pubDate).getTime();
			
			const aIsFresh = aAge < 6 * 3600 * 1000;
			const bIsFresh = bAge < 6 * 3600 * 1000;
			
			if (aIsFresh && !bIsFresh) return -1;
			if (!aIsFresh && bIsFresh) return 1;
			
			return b.pubDate.localeCompare(a.pubDate);
		});
			
			logger.debug({ 
				targetCategory, 
				totalNew: newOnes.length,
				categorizedCount: categorizedArticles.length,
				newestCategorizedDate: categorizedArticles[0]?.pubDate
			}, 'scheduler: filtered by category');
			
			if (categorizedArticles.length === 0) {
				logger.debug({ targetCategory, totalNew: newOnes.length }, 'scheduler: no articles in target category');
				return;
			}
			
			const article = categorizedArticles[0]!;
			
			const { getArticleId, loadPostedIds } = await import('../storage');
			const postedIds = await loadPostedIds();
			const articleId = getArticleId(article);
			
			if (postedIds.has(articleId)) {
			logger.warn({ 
				title: article.title, 
				link: article.link,
				articleId 
			}, 'scheduler: article already posted (duplicate detected)');
				return;
			}
			
			if (article.link.includes('reddit.com')) {
				const isValid = await validateRedditLink(article.link);
				if (!isValid) {
					logger.warn({ title: article.title, link: article.link, articleId }, 'Skipping deleted/removed Reddit post');
					await markArticlesPosted([article]);
					return;
				}
			}
			
			logger.info({ title: article.title, link: article.link, category: targetCategory, articleId }, 'scheduler: preparing article for posting');
			
			const { createEnhancedPostWithFallback } = await import('../services/post-service');
			const message = await createEnhancedPostWithFallback(article);
			
			if (!message) {
				logger.warn({ 
					title: article.title,
					link: article.link 
				}, 'Skipping scheduled post due to failed AI analysis');
				return;
			}

			if (this.previewMode) {
				await this.sendPreview(article, message, targetChat);
				return;
			}

			try {
			await sendPostWithImage(targetChat, message, article.imageUrl);
				await markArticlesPosted([article]);
				counters.postsSent.inc();
			} catch (err) {
				if (article.link.includes('reddit.com')) {
					logger.error({ 
						title: article.title, 
						link: article.link,
						error: err instanceof Error ? err.message : String(err)
					}, 'Failed to post Reddit article - possibly deleted after validation');
					
					await markArticlesPosted([article]);
					
					if (this.bot && process.env.TELEGRAM_ADMIN_CHAT_ID) {
						try {
							await this.bot.telegram.sendMessage(
								process.env.TELEGRAM_ADMIN_CHAT_ID,
								`⚠️ <b>Skipped Deleted Reddit Post</b>\n\n<b>Title:</b> ${article.title}\n\n<b>Link:</b> ${article.link}\n\n<i>Post was deleted/removed after validation.</i>`,
								{ parse_mode: 'HTML' }
							);
						} catch {}
					}
				} else {
					throw err;
				}
			}
			
			logger.info({ 
				title: article.title, 
				link: article.link, 
				category: targetCategory,
				articleId,
				messageLength: message.length 
			}, 'scheduler: successfully posted article to channel');
			
		} catch (err) {
			logger.error({ err }, 'scheduler: failed to process articles');
			counters.errorsTotal.inc({ scope: 'scheduler' });
		}
	}

	async testScheduler(): Promise<{
		totalArticles: number;
		newArticles: number;
		categorizedArticles: number;
		nextArticle?: {
			title: string;
			source: string;
			pubDate: string;
			category: string;
		};
		configuration: {
			targetCategory: string;
			targetChannel?: string;
		};
	}> {
		try {
			const articles = await fetchAllArticles(undefined, { maxAgeHours: 48 });
			articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			const newOnes = await filterNewArticles(articles, { maxAgeHours: 48 });
			newOnes.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
			const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
			categorizedArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			const result = {
				totalArticles: articles.length,
				newArticles: newOnes.length,
				categorizedArticles: categorizedArticles.length,
				configuration: {
					targetCategory,
					targetChannel: process.env.TELEGRAM_TARGET_CHAT_ID
				}
			} as any;
			
			if (categorizedArticles.length > 0) {
				const nextArticle = categorizedArticles[0]!;
				const { getSourceDomain } = await import('../utils/time');
				
				result.nextArticle = {
					title: nextArticle.title,
					source: getSourceDomain(nextArticle.link),
					pubDate: nextArticle.pubDate,
					category: targetCategory
				};
			}
			
			return result;
		} catch (err) {
			logger.error({ err }, 'scheduler test failed');
			throw err;
		}
	}

	async triggerManually(): Promise<void> {
		logger.info('Manually triggering scheduler');
		await this.processArticles();
	}

	enableAutoPosting(): void {
		process.env.AUTO_POSTING_ENABLED = 'true';
		logger.info('Automatic posting enabled');
	}

	disableAutoPosting(): void {
		process.env.AUTO_POSTING_ENABLED = 'false';
		logger.info('Automatic posting disabled');
	}

	toggleAutoPosting(): boolean {
		const isEnabled = this.isAutoPostingEnabled();
		if (isEnabled) {
			this.disableAutoPosting();
		} else {
			this.enableAutoPosting();
		}
		return !isEnabled;
	}

	private async sendPreview(article: Article, message: string, targetChat: string): Promise<void> {
		if (!this.bot) {
			logger.error('Bot instance not set, cannot send preview');
			return;
		}

		try {
			const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || targetChat;
			const postId = `${Date.now()}_${article.link.substring(article.link.length - 10)}`;
			
			pendingPosts.set(postId, {
				article,
				message,
				timestamp: Date.now()
			});

			const { getSourceDomain, getTimeAgo } = await import('../utils/time');
			const sourceDomain = getSourceDomain(article.link);
			const timeAgo = getTimeAgo(article.pubDate);
			const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
			
			const categoryEmoji = {
				'AI Tool': '🛠️',
				'Tech News': '📰',
				'Business Use-Case': '💼',
				'Job Opportunity': '🔍',
				'Sponsored Deal': '💰',
				'Developer Prompts': '💻'
			}[targetCategory] || '📋';

			const previewHeader = 
				`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
				`┃ 👁️ <b>POST PREVIEW</b> - Review Required\n` +
				`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
				`${categoryEmoji} <b>Category:</b> ${targetCategory}\n` +
				`🌐 <b>Source:</b> ${sourceDomain}\n` +
				`⏰ <b>Published:</b> ${timeAgo}\n` +
				`📊 <b>Pending Posts:</b> ${pendingPosts.size}\n` +
				`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

			const fullPreview = previewHeader + message;
			const previewLength = fullPreview.length;
			const captionLimit = 1024;

			const keyboard = Markup.inlineKeyboard([
				[
					Markup.button.callback('✅ Send Now', `confirm_${postId}`),
					Markup.button.callback('⏭️ Skip', `skip_${postId}`)
				],
				[
					Markup.button.callback('🔄 Regenerate', `regenerate_${postId}`),
					Markup.button.callback('❌ Cancel', `cancel_${postId}`)
				],
				[
					Markup.button.callback('📝 View Original', `view_${postId}`),
					Markup.button.callback('📋 Preview List', `list_previews`)
				]
			]);

			if (article.imageUrl) {
				try {
					if (previewLength <= captionLimit) {
						await this.bot.telegram.sendPhoto(adminChatId, article.imageUrl, {
							caption: fullPreview,
							parse_mode: 'HTML',
							...keyboard
						});
					} else {
						const shortCaption = 
							`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
							`┃ 👁️ <b>POST PREVIEW</b> - Review Required\n` +
							`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
							`${categoryEmoji} ${targetCategory} • 🌐 ${sourceDomain}\n` +
							`⏰ ${timeAgo} • 📊 ${pendingPosts.size} pending`;

						await this.bot.telegram.sendPhoto(adminChatId, article.imageUrl, {
							caption: shortCaption,
							parse_mode: 'HTML'
						});

						await this.bot.telegram.sendMessage(adminChatId, fullPreview, {
							parse_mode: 'HTML',
							link_preview_options: { is_disabled: true },
							...keyboard
						});
					}
					
					logger.info({ 
						postId, 
						title: article.title,
						adminChatId,
						previewLength,
						hasImage: true,
						splitMessage: previewLength > captionLimit
					}, 'Preview sent to admin with image');
					
				} catch (err) {
					logger.warn({ err, imageUrl: article.imageUrl }, 'Failed to send preview with image, falling back to text');
					
					await this.bot.telegram.sendMessage(adminChatId, fullPreview, {
						parse_mode: 'HTML',
						link_preview_options: { is_disabled: true },
						...keyboard
					});
					
					logger.info({ 
						postId, 
						title: article.title,
						adminChatId,
						hasImage: false
					}, 'Preview sent to admin (text fallback)');
				}
			} else {
				await this.bot.telegram.sendMessage(adminChatId, fullPreview, {
					parse_mode: 'HTML',
					link_preview_options: { is_disabled: true },
					...keyboard
				});
				
				logger.info({ 
					postId, 
					title: article.title,
					adminChatId,
					previewLength,
					hasImage: false
				}, 'Preview sent to admin for confirmation');
			}

		} catch (err) {
			logger.error({ 
				err, 
				articleTitle: article.title,
				articleLink: article.link
			}, 'Failed to send preview');
		}
	}

	async confirmPost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			logger.warn({ postId }, 'Attempted to confirm non-existent post');
			return '❌ <b>Post Not Found</b>\n\nThis preview has expired or was already processed. Please check <code>/previews</code> for current pending posts.';
		}

		try {
			const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
			if (!targetChat) {
				logger.error('Target chat not configured');
				return '❌ <b>Configuration Error</b>\n\nTarget channel not configured. Please set TELEGRAM_TARGET_CHAT_ID in environment variables.';
			}

			logger.info({ postId, title: pending.article.title }, 'Sending confirmed post to channel');
			await sendPostWithImage(targetChat, pending.message, pending.article.imageUrl);
			await markArticlesPosted([pending.article]);
			counters.postsSent.inc();

			pendingPosts.delete(postId);

			logger.info({ 
				postId, 
				title: pending.article.title,
				targetChat
			}, 'Post confirmed and sent to channel successfully');

			const { getSourceDomain } = await import('../utils/time');
			const sourceDomain = getSourceDomain(pending.article.link);

			return `✅ <b>Post Sent Successfully!</b>\n\n📰 ${pending.article.title.substring(0, 60)}${pending.article.title.length > 60 ? '...' : ''}\n🌐 Source: ${sourceDomain}\n📢 Sent to channel`;

		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			logger.error({ err, postId, title: pending.article.title }, 'Failed to send confirmed post');
			return `❌ <b>Failed to Send Post</b>\n\n<b>Error:</b> ${errorMsg}\n\n<i>The post remains in the preview queue. You can try again or skip it.</i>`;
		}
	}

	async skipPost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			logger.warn({ postId }, 'Attempted to skip non-existent post');
			return '❌ <b>Post Not Found</b>\n\nThis preview has expired or was already processed.';
		}

		try {
			await markArticlesPosted([pending.article]);
			pendingPosts.delete(postId);

			logger.info({ postId, title: pending.article.title }, 'Post skipped by admin');
			
			const { getSourceDomain } = await import('../utils/time');
			const sourceDomain = getSourceDomain(pending.article.link);
			
			return `⏭️ <b>Post Skipped</b>\n\n📰 ${pending.article.title.substring(0, 60)}${pending.article.title.length > 60 ? '...' : ''}\n🌐 Source: ${sourceDomain}\n\n<i>This article will not be shown again.</i>`;
		} catch (err) {
			logger.error({ err, postId }, 'Failed to skip post');
			return '❌ <b>Failed to Skip Post</b>\n\nAn error occurred. Please try again.';
		}
	}

	async regeneratePost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			logger.warn({ postId }, 'Attempted to regenerate non-existent post');
			return '❌ <b>Post Not Found</b>\n\nThis preview has expired or was already processed.';
		}

		try {
			logger.info({ postId, title: pending.article.title }, 'Regenerating post');
			
			const { createEnhancedPostWithFallback } = await import('../services/post-service');
			const newMessage = await createEnhancedPostWithFallback(pending.article);
			
			if (!newMessage) {
				logger.warn({ postId, title: pending.article.title }, 'AI analysis failed during regeneration');
				return '❌ <b>Regeneration Failed</b>\n\nAI analysis failed. This may indicate:\n• Article content is not suitable\n• AI provider is experiencing issues\n\n<i>Try skipping this post or wait a moment and try again.</i>';
			}

			pending.message = newMessage;
			pending.timestamp = Date.now();
			pendingPosts.set(postId, pending);

			const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID || '';
			await this.sendPreview(pending.article, newMessage, targetChat);

			logger.info({ postId, title: pending.article.title }, 'Post regenerated successfully');
			return '🔄 <b>Post Regenerated!</b>\n\nCheck the new preview above with updated AI analysis.';

		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			logger.error({ err, postId, title: pending.article.title }, 'Failed to regenerate post');
			return `❌ <b>Regeneration Failed</b>\n\n<b>Error:</b> ${errorMsg}\n\n<i>You can try again or skip this post.</i>`;
		}
	}

	async cancelPost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			logger.warn({ postId }, 'Attempted to cancel non-existent post');
			return '❌ <b>Post Not Found</b>\n\nThis preview has expired or was already processed.';
		}

		try {
			const { getSourceDomain } = await import('../utils/time');
			const sourceDomain = getSourceDomain(pending.article.link);
			
			pendingPosts.delete(postId);
			logger.info({ postId, title: pending.article.title }, 'Post canceled by admin');
			
			return `❌ <b>Post Canceled</b>\n\n📰 ${pending.article.title.substring(0, 60)}${pending.article.title.length > 60 ? '...' : ''}\n🌐 Source: ${sourceDomain}\n\n<i>The article will remain available for future posting.</i>`;
		} catch (err) {
			logger.error({ err, postId }, 'Failed to cancel post');
			pendingPosts.delete(postId);
			return '❌ <b>Post Removed</b>\n\nPreview has been removed from the queue.';
		}
	}

	async viewArticle(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			return '❌ Post not found or expired';
		}

		const article = pending.article;
		const { getSourceDomain, getTimeAgo } = await import('../utils/time');
		const sourceDomain = getSourceDomain(article.link);
		const timeAgo = getTimeAgo(article.pubDate);
		
		let details = `📰 <b>Original Article Details</b>\n\n`;
		details += `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
		details += `<b>📌 Title:</b>\n${article.title}\n\n`;
		details += `<b>🌐 Source:</b> ${sourceDomain}\n`;
		details += `<b>⏰ Published:</b> ${timeAgo}\n`;
		details += `<b>🔗 Link:</b>\n${article.link}\n`;
		details += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
		details += `<b>📝 Content Snippet:</b>\n${article.contentSnippet.substring(0, 500)}${article.contentSnippet.length > 500 ? '...' : ''}`;

		return details;
	}

	async listPendingPosts(): Promise<string> {
		if (pendingPosts.size === 0) {
			return '✅ <b>No Pending Previews</b>\n\nAll posts have been reviewed. Waiting for new articles...';
		}

		const { getTimeAgo } = await import('../utils/time');
		let list = `📋 <b>Pending Post Previews</b> (${pendingPosts.size})\n\n`;
		
		let index = 1;
		for (const [, pending] of pendingPosts.entries()) {
			const { getSourceDomain } = await import('../utils/time');
			const sourceDomain = getSourceDomain(pending.article.link);
			const timeAgo = getTimeAgo(pending.article.pubDate);
			const waitTime = Math.floor((Date.now() - pending.timestamp) / 1000 / 60);
			
			list += `${index}. <b>${pending.article.title.substring(0, 50)}${pending.article.title.length > 50 ? '...' : ''}</b>\n`;
			list += `   🌐 ${sourceDomain} • ⏰ ${timeAgo}\n`;
			list += `   ⏳ Pending for ${waitTime}m\n\n`;
			
			index++;
			if (index > 10) {
				list += `... and ${pendingPosts.size - 10} more\n`;
				break;
			}
		}
		
		list += `\n💡 <i>Tip: Review each preview and click "Send Now" or "Skip"</i>`;
		
		return list;
	}

	cleanupOldPendingPosts(): number {
		const maxAge = 24 * 60 * 60 * 1000;
		const now = Date.now();
		let cleanedCount = 0;

		for (const [id, pending] of pendingPosts.entries()) {
			if (now - pending.timestamp > maxAge) {
				pendingPosts.delete(id);
				cleanedCount++;
				logger.info({ 
					postId: id, 
					title: pending.article.title,
					age: Math.floor((now - pending.timestamp) / 1000 / 60 / 60) 
				}, 'Cleaned up expired pending post');
			}
		}

		return cleanedCount;
	}

	getStatus(): {
		isRunning: boolean;
		isSchedulerRunning: boolean;
		autoPostingEnabled: boolean;
		previewMode: boolean;
		pendingPosts: number;
		configuration: {
			targetCategory: string;
			targetChannel?: string;
			adminChatId?: string;
			cronPattern: string;
		};
	} {
		return {
			isRunning: true,
			isSchedulerRunning: this.isSchedulerRunning,
			autoPostingEnabled: this.isAutoPostingEnabled(),
			previewMode: this.previewMode,
			pendingPosts: pendingPosts.size,
			configuration: {
				targetCategory: (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool',
				...(process.env.TELEGRAM_TARGET_CHAT_ID && { targetChannel: process.env.TELEGRAM_TARGET_CHAT_ID }),
				...(process.env.TELEGRAM_ADMIN_CHAT_ID && { adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID }),
				cronPattern: '*/90 * * * * *'
			}
		};
	}
}

export const schedulerService = new SchedulerService();

export function startScheduler(): void {
	schedulerService.startScheduler();
}

export async function testScheduler(): Promise<ReturnType<SchedulerService['testScheduler']>> {
	return await schedulerService.testScheduler();
}

export function triggerSchedulerManually(): Promise<void> {
	return schedulerService.triggerManually();
}

export function getSchedulerStatus(): ReturnType<SchedulerService['getStatus']> {
	return schedulerService.getStatus();
}

export function enableAutoPosting(): void {
	schedulerService.enableAutoPosting();
}

export function disableAutoPosting(): void {
	schedulerService.disableAutoPosting();
}

export function toggleAutoPosting(): boolean {
	return schedulerService.toggleAutoPosting();
}

export function setSchedulerBot(bot: Telegraf): void {
	schedulerService.setBot(bot);
}

export function setPreviewMode(enabled: boolean): void {
	schedulerService.setPreviewMode(enabled);
}

export function isPreviewMode(): boolean {
	return schedulerService.isPreviewMode();
}

export function confirmPost(postId: string): Promise<string> {
	return schedulerService.confirmPost(postId);
}

export function skipPost(postId: string): Promise<string> {
	return schedulerService.skipPost(postId);
}

export function regeneratePost(postId: string): Promise<string> {
	return schedulerService.regeneratePost(postId);
}

export function cancelPost(postId: string): Promise<string> {
	return schedulerService.cancelPost(postId);
}

export function viewArticle(postId: string): Promise<string> {
	return schedulerService.viewArticle(postId);
}

export function listPendingPosts(): Promise<string> {
	return schedulerService.listPendingPosts();
}

export function cleanupOldPendingPosts(): number {
	return schedulerService.cleanupOldPendingPosts();
}
