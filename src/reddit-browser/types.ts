/**
 * Reddit Browser Types and Interfaces
 */

export interface RedditFeedConfig {
	name: string; // Subreddit name (without r/)
	category: 'AI Tool' | 'AI News' | 'Business' | 'Developer';
	priority: number; // Lower = higher priority (1 is highest)
	sortBy: 'top' | 'new' | 'hot';
	timeframe: 'hour' | 'day' | 'week' | 'month';
	enabled: boolean;
	description?: string;
}

export interface RedditBrowsingSession {
	userId: number;
	chatId: number;
	currentIndex: number; // Current position in priority list
	visitedSubreddits: Set<string>;
	skippedArticles: Set<string>;
	postedArticles: Set<string>;
	startedAt: number; // timestamp
	expiresAt: number; // timestamp
	lastMessageId?: number; // For message cleanup
	currentArticle?: any; // Current article being previewed (to avoid passing long URLs in buttons)
}

export interface BrowseProgress {
	current: number;
	total: number;
	posted: number;
	skipped: number;
}

export interface RedditArticlePreview {
	article: any; // Article type
	subreddit: string;
	formattedMessage: string;
	progress: BrowseProgress;
	nextSubreddit?: string | undefined;
}

