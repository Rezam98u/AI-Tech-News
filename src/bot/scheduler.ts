/**
 * Bot scheduler - extracted from main index.ts
 */
import cron from 'node-cron';
import { logger } from '../logger';
import { counters } from '../metrics';
import { fetchAllArticles } from '../data-aggregator';
import { filterNewArticles, markArticlesPosted } from '../storage';
import { filterArticlesByCategory, ContentCategory } from '../categorizer';
import { createEnhancedPost, sendPostWithImage } from '../services/post-service';

/**
 * Article scheduler service
 */
export class SchedulerService {
	private isSchedulerRunning = false;

	/**
	 * Start the article scheduler
	 */
	startScheduler(): void {
		// Check environment configuration
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			logger.warn('TELEGRAM_TARGET_CHAT_ID not set; scheduler will not post');
		}

		// Schedule to run every second (for testing and quick responses)
		cron.schedule('* * * * * *', async () => {
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

		logger.info('Article scheduler started');
	}

	/**
	 * Process articles for posting
	 */
	private async processArticles(): Promise<void> {
		try {
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
			}, 'scheduler: posting new article to channel');
			
			// Create enhanced post and send to channel
			const message = await createEnhancedPost(article);
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
	 * Get scheduler status
	 */
	getStatus(): {
		isRunning: boolean;
		isSchedulerRunning: boolean;
		configuration: {
			targetCategory: string;
			targetChannel?: string;
			cronPattern: string;
		};
	} {
		return {
			isRunning: true, // Scheduler is always running once started
			isSchedulerRunning: this.isSchedulerRunning,
		configuration: {
			targetCategory: (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool',
			...(process.env.TELEGRAM_TARGET_CHAT_ID && { targetChannel: process.env.TELEGRAM_TARGET_CHAT_ID }),
			cronPattern: '* * * * * *' // Every second
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
