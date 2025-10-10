/**
 * Reddit Browser Service
 * Manages interactive Reddit browsing sessions
 */

import { Telegraf } from 'telegraf';
import { logger } from '../logger';
import { Article } from '../types';
import { RedditBrowsingSession, RedditArticlePreview, BrowseProgress } from './types';
import { 
	getEnabledRedditFeeds, 
	getRedditRssUrl, 
	SESSION_TIMEOUT_MS
} from './config';
import { fetchSingleRedditFeed } from '../data-aggregator';
import { markArticlesPosted } from '../storage';
import { counters } from '../metrics';

export class RedditBrowserService {
	private sessions: Map<number, RedditBrowsingSession> = new Map();
	private bot?: Telegraf;

	setBot(bot: Telegraf): void {
		this.bot = bot;
	}

	/**
	 * Start a new browsing session for a user
	 */
	async startSession(userId: number, chatId: number): Promise<void> {
		// Clean up expired sessions
		this.cleanupExpiredSessions();

		// End existing session if any
		if (this.sessions.has(userId)) {
			logger.info({ userId }, 'Ending existing Reddit browsing session');
			this.sessions.delete(userId);
		}

		// Create new session
		const session: RedditBrowsingSession = {
			userId,
			chatId,
			currentIndex: 0,
			visitedSubreddits: new Set(),
			skippedArticles: new Set(),
			postedArticles: new Set(),
			startedAt: Date.now(),
			expiresAt: Date.now() + SESSION_TIMEOUT_MS,
		};

		this.sessions.set(userId, session);
		
		logger.info({ 
			userId, 
			chatId,
			totalFeeds: getEnabledRedditFeeds().length 
		}, 'Started Reddit browsing session');
	}

	/**
	 * Get current session for user
	 */
	getSession(userId: number): RedditBrowsingSession | undefined {
		const session = this.sessions.get(userId);
		
		// Check if session expired
		if (session && Date.now() > session.expiresAt) {
			logger.info({ userId }, 'Reddit browsing session expired');
			this.sessions.delete(userId);
			return undefined;
		}

		return session;
	}

	/**
	 * End browsing session
	 */
	endSession(userId: number): void {
		this.sessions.delete(userId);
		logger.info({ userId }, 'Ended Reddit browsing session');
	}

	/**
	 * Get next article to preview
	 */
	async getNextArticle(userId: number): Promise<RedditArticlePreview | null> {
		const session = this.getSession(userId);
		if (!session) {
			logger.warn({ userId }, 'No active browsing session');
			return null;
		}

		const feeds = getEnabledRedditFeeds();
		
		// Check if we've reached the end
		if (session.currentIndex >= feeds.length) {
			logger.info({ userId, totalVisited: session.visitedSubreddits.size }, 'Completed browsing all feeds');
			return null;
		}

		const currentFeed = feeds[session.currentIndex];
		if (!currentFeed) {
			logger.error({ userId, index: session.currentIndex }, 'Failed to get feed at index');
			return null;
		}
		
		const url = getRedditRssUrl(currentFeed);

		logger.info({ 
			userId, 
			subreddit: currentFeed.name,
			index: session.currentIndex,
			total: feeds.length 
		}, 'Fetching Reddit feed for browsing');

		try {
			// Fetch articles from this subreddit
			const articles = await fetchSingleRedditFeed(url, currentFeed.name);
			
			// Filter out already posted/skipped articles
			const availableArticles = articles.filter(article => 
				!session.skippedArticles.has(article.link) &&
				!session.postedArticles.has(article.link)
			);

			if (availableArticles.length === 0) {
				logger.info({ 
					userId, 
					subreddit: currentFeed.name 
				}, 'No new articles in this subreddit, moving to next');
				
				// Mark as visited and move to next
				session.visitedSubreddits.add(currentFeed.name);
				session.currentIndex++;
				
				// Recursively get next
				return await this.getNextArticle(userId);
			}

			// Get the first (top) article
			const article = availableArticles[0];
			if (!article) {
				logger.warn({ 
					userId, 
					subreddit: currentFeed.name 
				}, 'No article available after filtering, moving to next');
				
				session.visitedSubreddits.add(currentFeed.name);
				session.currentIndex++;
				return await this.getNextArticle(userId);
			}
			
			// Create enhanced post with fallback retry logic
			const { createEnhancedPostWithFallback } = await import('../services/post-service');
			const message = await createEnhancedPostWithFallback(article);
			
			if (!message) {
				logger.warn({ 
					userId, 
					subreddit: currentFeed.name,
					title: article.title 
				}, 'Failed to create enhanced post, skipping');
				
				session.skippedArticles.add(article.link);
				return await this.getNextArticle(userId);
			}

			// Mark subreddit as visited
			session.visitedSubreddits.add(currentFeed.name);

			// Build progress info
			const progress: BrowseProgress = {
				current: session.currentIndex + 1,
				total: feeds.length,
				posted: session.postedArticles.size,
				skipped: session.skippedArticles.size
			};

			// Get next subreddit name (if available)
			const nextSubreddit = session.currentIndex + 1 < feeds.length 
				? feeds[session.currentIndex + 1]?.name 
				: undefined;

			// Store current article in session (to avoid passing long URLs in button callbacks)
			session.currentArticle = article;

			return {
				article,
				subreddit: currentFeed.name,
				formattedMessage: message,
				progress,
				...(nextSubreddit && { nextSubreddit })
			};

		} catch (err) {
			logger.error({ 
				err: err instanceof Error ? err.message : String(err),
				userId,
				subreddit: currentFeed.name 
			}, 'Failed to fetch Reddit feed for browsing');
			
			// Mark as visited and move to next
			session.visitedSubreddits.add(currentFeed.name);
			session.currentIndex++;
			
			// Recursively get next
			return await this.getNextArticle(userId);
		}
	}

	/**
	 * Confirm and post article to channel
	 */
	async confirmPost(userId: number, articleLink: string): Promise<boolean> {
		const session = this.getSession(userId);
		if (!session) {
			return false;
		}

		try {
			const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
			if (!targetChat || !this.bot) {
				logger.error({ userId }, 'Cannot post: missing target chat or bot instance');
				return false;
			}

			// The article should already be in the preview, so we just need to get it
			// For now, we'll mark it as posted in session
			session.postedArticles.add(articleLink);
			session.currentIndex++; // Move to next subreddit

			counters.postsSent.inc();
			logger.info({ 
				userId, 
				articleLink: articleLink.substring(0, 80),
				posted: session.postedArticles.size 
			}, 'Article posted to channel via Reddit browser');

			return true;

		} catch (err) {
			logger.error({ 
				err: err instanceof Error ? err.message : String(err),
				userId,
				articleLink: articleLink.substring(0, 80)
			}, 'Failed to post article from Reddit browser');
			return false;
		}
	}

	/**
	 * Skip article and move to next
	 */
	skipArticle(userId: number, articleLink: string): void {
		const session = this.getSession(userId);
		if (!session) {
			return;
		}

		session.skippedArticles.add(articleLink);
		session.currentIndex++; // Move to next subreddit
		
		logger.info({ 
			userId, 
			articleLink: articleLink.substring(0, 80),
			skipped: session.skippedArticles.size 
		}, 'Article skipped in Reddit browser');
	}

	/**
	 * Skip article forever (mark as posted so it never shows again)
	 */
	async skipForever(userId: number, article: Article): Promise<void> {
		const session = this.getSession(userId);
		if (!session) {
			return;
		}

		session.skippedArticles.add(article.link);
		session.currentIndex++; // Move to next subreddit

		// Mark as posted in storage to never show again
		await markArticlesPosted([article]);
		
		logger.info({ 
			userId, 
			articleLink: article.link.substring(0, 80)
		}, 'Article permanently skipped in Reddit browser');
	}

	/**
	 * Get session summary
	 */
	getSessionSummary(userId: number): string | null {
		const session = this.getSession(userId);
		if (!session) {
			return null;
		}

		const feeds = getEnabledRedditFeeds();
		const duration = Math.floor((Date.now() - session.startedAt) / 1000 / 60);

		return `📊 <b>Browsing Session Summary</b>\n\n` +
			`⏱️ Duration: ${duration} minutes\n` +
			`📂 Browsed: ${session.visitedSubreddits.size}/${feeds.length} subreddits\n` +
			`✅ Posted: ${session.postedArticles.size} articles\n` +
			`⏭️ Skipped: ${session.skippedArticles.size} articles`;
	}

	/**
	 * Clean up expired sessions
	 */
	private cleanupExpiredSessions(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [userId, session] of this.sessions.entries()) {
			if (now > session.expiresAt) {
				this.sessions.delete(userId);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.info({ cleaned }, 'Cleaned up expired Reddit browsing sessions');
		}
	}

	/**
	 * Get active session count
	 */
	getActiveSessionCount(): number {
		this.cleanupExpiredSessions();
		return this.sessions.size;
	}
}

// Export singleton instance
export const redditBrowser = new RedditBrowserService();

