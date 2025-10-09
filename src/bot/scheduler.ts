/**
 * Bot scheduler - extracted from main index.ts
 */
import cron from 'node-cron';
import { Telegraf, Markup } from 'telegraf';
import { logger } from '../logger';
import { counters } from '../metrics';
import { fetchAllArticles } from '../data-aggregator';
import { filterNewArticles, markArticlesPosted } from '../storage';
import { filterArticlesByCategory, ContentCategory } from '../categorizer';
import { createEnhancedPost, sendPostWithImage } from '../services/post-service';
import { Article } from '../types';

// Store pending posts for preview/confirmation
interface PendingPost {
	article: Article;
	message: string;
	timestamp: number;
}

const pendingPosts = new Map<string, PendingPost>();

/**
 * Article scheduler service
 */
export class SchedulerService {
	private isSchedulerRunning = false;
	private bot?: Telegraf;
	private previewMode: boolean = true; // Enable preview mode by default

	/**
	 * Set the bot instance for sending previews
	 */
	setBot(bot: Telegraf): void {
		this.bot = bot;
	}

	/**
	 * Enable or disable preview mode
	 */
	setPreviewMode(enabled: boolean): void {
		this.previewMode = enabled;
		logger.info({ previewMode: enabled }, 'Preview mode updated');
	}

	/**
	 * Get preview mode status
	 */
	isPreviewMode(): boolean {
		return this.previewMode;
	}

	/**
	 * Start the article scheduler
	 */
	startScheduler(): void {
		// Check environment configuration
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			logger.warn('TELEGRAM_TARGET_CHAT_ID not set; scheduler will not post');
		}

		// Schedule to run every 90 seconds
		cron.schedule('*/90 * * * * *', async () => {
			counters.cronRuns.inc();
			
			// Prevent concurrent scheduler runs
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

	/**
	 * Check if automatic posting is enabled
	 */
	private isAutoPostingEnabled(): boolean {
		const autoPostingEnabled = process.env.AUTO_POSTING_ENABLED === 'true';
		return autoPostingEnabled;
	}

	/**
	 * Process articles for posting
	 */
	private async processArticles(): Promise<void> {
		try {
			// Clean up old pending posts periodically
			const cleanedCount = this.cleanupOldPendingPosts();
			if (cleanedCount > 0) {
				logger.info({ cleanedCount }, 'Cleaned up expired pending posts');
			}

			// Check if automatic posting is enabled
			if (!this.isAutoPostingEnabled()) {
				logger.debug('scheduler: automatic posting is disabled');
				return;
			}

			const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
			
			// Fetch articles from the last week
			const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
			
			// Ensure articles are sorted by newest first before filtering
			articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
			
			// Sort new articles by publication date (newest first)
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
			
			// Filter by target category (default to AI Tool)
			const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
			const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
			
			// Ensure categorized articles are sorted by newest first
			categorizedArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
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
			
			// Post the first categorized article
			const article = categorizedArticles[0]!;
			
			// Double-check this article hasn't been posted (extra safety)
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
			
			logger.info({ 
				title: article.title, 
				link: article.link, 
				category: targetCategory,
				articleId 
			}, 'scheduler: preparing article for posting');
		
			// Create enhanced post
			const message = await createEnhancedPost(article);
		
			// Skip posting if analysis failed (fallback)
			if (!message) {
				logger.warn({ 
					title: article.title,
					link: article.link 
				}, 'Skipping scheduled post due to failed AI analysis');
				return;
			}

			// If preview mode is enabled, send preview for confirmation instead of posting
			if (this.previewMode) {
				await this.sendPreview(article, message, targetChat);
				return;
			}

			// Direct post mode (no preview)
			await sendPostWithImage(targetChat, message, article.imageUrl);
			await markArticlesPosted([article]);
			counters.postsSent.inc();
			
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

	/**
	 * Test the scheduler logic without actually posting
	 */
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
			const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
			articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
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

	/**
	 * Manually trigger article processing (for testing)
	 */
	async triggerManually(): Promise<void> {
		logger.info('Manually triggering scheduler');
		await this.processArticles();
	}

	/**
	 * Enable automatic posting
	 */
	enableAutoPosting(): void {
		process.env.AUTO_POSTING_ENABLED = 'true';
		logger.info('Automatic posting enabled');
	}

	/**
	 * Disable automatic posting
	 */
	disableAutoPosting(): void {
		process.env.AUTO_POSTING_ENABLED = 'false';
		logger.info('Automatic posting disabled');
	}

	/**
	 * Toggle automatic posting
	 */
	toggleAutoPosting(): boolean {
		const isEnabled = this.isAutoPostingEnabled();
		if (isEnabled) {
			this.disableAutoPosting();
		} else {
			this.enableAutoPosting();
		}
		return !isEnabled; // Return new state
	}

	/**
	 * Send preview to admin for confirmation
	 */
	private async sendPreview(article: Article, message: string, targetChat: string): Promise<void> {
		if (!this.bot) {
			logger.error('Bot instance not set, cannot send preview');
			return;
		}

		try {
			const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || targetChat;
			const postId = `${Date.now()}_${article.link.substring(article.link.length - 10)}`;
			
			// Store pending post
			pendingPosts.set(postId, {
				article,
				message,
				timestamp: Date.now()
			});

			// Get enhanced metadata
			const { getSourceDomain, getTimeAgo } = await import('../utils/time');
			const sourceDomain = getSourceDomain(article.link);
			const timeAgo = getTimeAgo(article.pubDate);
			const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
			
			// Determine category emoji
			const categoryEmoji = {
				'AI Tool': '🛠️',
				'Tech News': '📰',
				'Business Use-Case': '💼',
				'Job Opportunity': '🔍',
				'Sponsored Deal': '💰',
				'Developer Prompts': '💻'
			}[targetCategory] || '📋';

			// Create enhanced preview header with better visual hierarchy
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
			
			// Calculate message length for better handling
			const previewLength = fullPreview.length;
			const captionLimit = 1024;

			// Create enhanced inline keyboard with better organization
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

			// Send preview with intelligent handling of image and text
			if (article.imageUrl) {
				try {
					if (previewLength <= captionLimit) {
						// If preview fits in caption, send as single message
						await this.bot.telegram.sendPhoto(adminChatId, article.imageUrl, {
							caption: fullPreview,
							parse_mode: 'HTML',
							...keyboard
						});
					} else {
						// If preview is too long, send image with short caption first
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

						// Then send full preview with buttons
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
					// Fallback to text if image fails
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
				// No image, send text only
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

	/**
	 * Handle confirmation of a pending post
	 */
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

			// Send to channel
			logger.info({ postId, title: pending.article.title }, 'Sending confirmed post to channel');
			await sendPostWithImage(targetChat, pending.message, pending.article.imageUrl);
			await markArticlesPosted([pending.article]);
			counters.postsSent.inc();

			// Clean up
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

	/**
	 * Handle skipping a pending post
	 */
	async skipPost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			logger.warn({ postId }, 'Attempted to skip non-existent post');
			return '❌ <b>Post Not Found</b>\n\nThis preview has expired or was already processed.';
		}

		try {
			// Mark as posted to skip it
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

	/**
	 * Handle regenerating a post
	 */
	async regeneratePost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			logger.warn({ postId }, 'Attempted to regenerate non-existent post');
			return '❌ <b>Post Not Found</b>\n\nThis preview has expired or was already processed.';
		}

		try {
			logger.info({ postId, title: pending.article.title }, 'Regenerating post');
			
			// Regenerate the post
			const newMessage = await createEnhancedPost(pending.article);
			
			if (!newMessage) {
				logger.warn({ postId, title: pending.article.title }, 'AI analysis failed during regeneration');
				return '❌ <b>Regeneration Failed</b>\n\nAI analysis failed. This may indicate:\n• Article content is not suitable\n• AI provider is experiencing issues\n\n<i>Try skipping this post or wait a moment and try again.</i>';
			}

			// Update stored message
			pending.message = newMessage;
			pending.timestamp = Date.now();
			pendingPosts.set(postId, pending);

			// Send new preview
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

	/**
	 * Handle canceling a pending post
	 */
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
			pendingPosts.delete(postId); // Still delete it
			return '❌ <b>Post Removed</b>\n\nPreview has been removed from the queue.';
		}
	}

	/**
	 * View full article details
	 */
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

	/**
	 * List all pending previews
	 */
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
			const waitTime = Math.floor((Date.now() - pending.timestamp) / 1000 / 60); // minutes
			
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

	/**
	 * Clean up old pending posts (older than 24 hours)
	 */
	cleanupOldPendingPosts(): number {
		const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
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

	/**
	 * Get scheduler status
	 */
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
			isRunning: true, // Scheduler is always running once started
			isSchedulerRunning: this.isSchedulerRunning,
			autoPostingEnabled: this.isAutoPostingEnabled(),
			previewMode: this.previewMode,
			pendingPosts: pendingPosts.size,
			configuration: {
				targetCategory: (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool',
				...(process.env.TELEGRAM_TARGET_CHAT_ID && { targetChannel: process.env.TELEGRAM_TARGET_CHAT_ID }),
				...(process.env.TELEGRAM_ADMIN_CHAT_ID && { adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID }),
				cronPattern: '*/90 * * * * *' // Every 90 seconds
			}
		};
	}
}

/**
 * Create a global scheduler instance
 */
export const schedulerService = new SchedulerService();

/**
 * Start the scheduler
 */
export function startScheduler(): void {
	schedulerService.startScheduler();
}

/**
 * Test the scheduler
 */
export async function testScheduler(): Promise<ReturnType<SchedulerService['testScheduler']>> {
	return await schedulerService.testScheduler();
}

/**
 * Manually trigger scheduler
 */
export function triggerSchedulerManually(): Promise<void> {
	return schedulerService.triggerManually();
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): ReturnType<SchedulerService['getStatus']> {
	return schedulerService.getStatus();
}

/**
 * Enable automatic posting
 */
export function enableAutoPosting(): void {
	schedulerService.enableAutoPosting();
}

/**
 * Disable automatic posting
 */
export function disableAutoPosting(): void {
	schedulerService.disableAutoPosting();
}

/**
 * Toggle automatic posting
 */
export function toggleAutoPosting(): boolean {
	return schedulerService.toggleAutoPosting();
}

/**
 * Set bot instance for scheduler
 */
export function setSchedulerBot(bot: Telegraf): void {
	schedulerService.setBot(bot);
}

/**
 * Set preview mode
 */
export function setPreviewMode(enabled: boolean): void {
	schedulerService.setPreviewMode(enabled);
}

/**
 * Get preview mode status
 */
export function isPreviewMode(): boolean {
	return schedulerService.isPreviewMode();
}

/**
 * Confirm a pending post
 */
export function confirmPost(postId: string): Promise<string> {
	return schedulerService.confirmPost(postId);
}

/**
 * Skip a pending post
 */
export function skipPost(postId: string): Promise<string> {
	return schedulerService.skipPost(postId);
}

/**
 * Regenerate a pending post
 */
export function regeneratePost(postId: string): Promise<string> {
	return schedulerService.regeneratePost(postId);
}

/**
 * Cancel a pending post
 */
export function cancelPost(postId: string): Promise<string> {
	return schedulerService.cancelPost(postId);
}

/**
 * View article details
 */
export function viewArticle(postId: string): Promise<string> {
	return schedulerService.viewArticle(postId);
}

/**
 * List all pending posts
 */
export function listPendingPosts(): Promise<string> {
	return schedulerService.listPendingPosts();
}

/**
 * Clean up old pending posts
 */
export function cleanupOldPendingPosts(): number {
	return schedulerService.cleanupOldPendingPosts();
}
