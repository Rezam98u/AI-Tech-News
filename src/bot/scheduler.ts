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

			// Create preview header
			const previewHeader = `📋 <b>POST PREVIEW - Awaiting Confirmation</b>\n\n` +
				`📰 Source: ${article.link.includes('reddit.com') ? 'Reddit' : 'News'}\n` +
				`⏰ Published: ${article.pubDate}\n` +
				`━━━━━━━━━━━━━━━━━━━━\n\n`;

			const fullPreview = previewHeader + message;

			// Create inline keyboard with action buttons
			const keyboard = Markup.inlineKeyboard([
				[
					Markup.button.callback('✅ Send to Channel', `confirm_${postId}`),
					Markup.button.callback('⏭️ Skip', `skip_${postId}`)
				],
				[
					Markup.button.callback('🔄 Regenerate', `regenerate_${postId}`),
					Markup.button.callback('❌ Cancel', `cancel_${postId}`)
				],
				[
					Markup.button.callback('📝 View Full Article', `view_${postId}`)
				]
			]);

			// Send preview with image if available
			if (article.imageUrl) {
				try {
					await this.bot.telegram.sendPhoto(adminChatId, article.imageUrl, {
						caption: fullPreview.substring(0, 1024), // Telegram caption limit
						parse_mode: 'HTML',
						...keyboard
					});
				} catch (err) {
					// Fallback to text if image fails
					await this.bot.telegram.sendMessage(adminChatId, fullPreview, {
						parse_mode: 'HTML',
						link_preview_options: { is_disabled: true },
						...keyboard
					});
				}
			} else {
				await this.bot.telegram.sendMessage(adminChatId, fullPreview, {
					parse_mode: 'HTML',
					link_preview_options: { is_disabled: true },
					...keyboard
				});
			}

			logger.info({ 
				postId, 
				title: article.title,
				adminChatId 
			}, 'Preview sent to admin for confirmation');

		} catch (err) {
			logger.error({ err }, 'Failed to send preview');
		}
	}

	/**
	 * Handle confirmation of a pending post
	 */
	async confirmPost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			return '❌ Post not found or expired. It may have already been processed.';
		}

		try {
			const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
			if (!targetChat) {
				return '❌ Target channel not configured';
			}

			// Send to channel
			await sendPostWithImage(targetChat, pending.message, pending.article.imageUrl);
			await markArticlesPosted([pending.article]);
			counters.postsSent.inc();

			// Clean up
			pendingPosts.delete(postId);

			logger.info({ 
				postId, 
				title: pending.article.title 
			}, 'Post confirmed and sent to channel');

			return '✅ Post sent to channel successfully!';

		} catch (err) {
			logger.error({ err, postId }, 'Failed to send confirmed post');
			return `❌ Failed to send post: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	/**
	 * Handle skipping a pending post
	 */
	async skipPost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			return '❌ Post not found or expired';
		}

		// Mark as posted to skip it
		await markArticlesPosted([pending.article]);
		pendingPosts.delete(postId);

		logger.info({ postId, title: pending.article.title }, 'Post skipped by admin');
		return '⏭️ Post skipped. It will not be shown again.';
	}

	/**
	 * Handle regenerating a post
	 */
	async regeneratePost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			return '❌ Post not found or expired';
		}

		try {
			// Regenerate the post
			const newMessage = await createEnhancedPost(pending.article);
			
			if (!newMessage) {
				return '❌ Failed to regenerate post - AI analysis failed';
			}

			// Update stored message
			pending.message = newMessage;
			pending.timestamp = Date.now();
			pendingPosts.set(postId, pending);

			// Send new preview
			const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID || '';
			await this.sendPreview(pending.article, newMessage, targetChat);

			logger.info({ postId, title: pending.article.title }, 'Post regenerated');
			return '🔄 Post regenerated! Check the new preview above.';

		} catch (err) {
			logger.error({ err, postId }, 'Failed to regenerate post');
			return `❌ Failed to regenerate: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	/**
	 * Handle canceling a pending post
	 */
	async cancelPost(postId: string): Promise<string> {
		const pending = pendingPosts.get(postId);
		
		if (!pending) {
			return '❌ Post not found or expired';
		}

		pendingPosts.delete(postId);
		logger.info({ postId, title: pending.article.title }, 'Post canceled by admin');
		return '❌ Post canceled. Article remains in queue.';
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
		let details = `📰 <b>Full Article Details</b>\n\n`;
		details += `<b>Title:</b> ${article.title}\n\n`;
		details += `<b>Link:</b> ${article.link}\n\n`;
		details += `<b>Published:</b> ${article.pubDate}\n\n`;
		details += `<b>Content Snippet:</b>\n${article.contentSnippet.substring(0, 500)}${article.contentSnippet.length > 500 ? '...' : ''}`;

		return details;
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
