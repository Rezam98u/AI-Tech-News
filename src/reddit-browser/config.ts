/**
 * Reddit Browser Configuration
 * Priority-based subreddit list for interactive browsing
 */

import { RedditFeedConfig } from './types';

export const REDDIT_FEED_PRIORITIES: RedditFeedConfig[] = [
	// ========================================
	// TOP PRIORITY - SIDE PROJECTS & TOOLS
	// ========================================
	{
		name: 'SideProject',
		category: 'AI Tool',
		priority: 1,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Side projects and weekend builds - TOP PRIORITY!'
	},
	
	// ========================================
	// HIGH PRIORITY - SAAS & INDIE PRODUCTS
	// ========================================
	{
		name: 'SaaS',
		category: 'Business',
		priority: 2,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Software as a Service startups and products'
	},
	{
		name: 'IMadeThis',
		category: 'AI Tool',
		priority: 3,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Makers showcasing their projects'
	},
	{
		name: 'indiehackers',
		category: 'Business',
		priority: 4,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Independent entrepreneurs and makers'
	},
	{
		name: 'microsaas',
		category: 'Business',
		priority: 5,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Micro SaaS businesses and tools'
	},
	
	// ========================================
	// MEDIUM PRIORITY - AI & DEV TOOLS
	// ========================================
	{
		name: 'PromptEngineering',
		category: 'AI Tool',
		priority: 6,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'AI prompts and prompt engineering techniques'
	},
	{
		name: 'nocode',
		category: 'AI Tool',
		priority: 7,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'No-code tools and solutions'
	},
	{
		name: 'automation',
		category: 'Developer',
		priority: 8,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Automation tools and workflows'
	},
	
	// ========================================
	// BUSINESS & ENTREPRENEURSHIP
	// ========================================
	{
		name: 'Entrepreneur',
		category: 'Business',
		priority: 9,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Entrepreneurship and business ventures'
	},
	{
		name: 'startups',
		category: 'Business',
		priority: 10,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Startup ecosystem and news'
	},
	{
		name: 'passive_income',
		category: 'Business',
		priority: 11,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Passive income strategies and tools'
	},
	{
		name: 'indiebiz',
		category: 'Business',
		priority: 12,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Independent business ventures'
	},
	{
		name: 'juststart',
		category: 'Business',
		priority: 13,
		sortBy: 'top',
		timeframe: 'day',
		enabled: true,
		description: 'Getting started with online business'
	},
	
	// ========================================
	// JOB BOARDS - LOWER PRIORITY
	// ========================================
	{
		name: 'forhire',
		category: 'Business',
		priority: 14,
		sortBy: 'new',
		timeframe: 'day',
		enabled: true,
		description: 'Freelance and contract opportunities'
	},
	{
		name: 'beermoney',
		category: 'Business',
		priority: 15,
		sortBy: 'new',
		timeframe: 'day',
		enabled: true,
		description: 'Side gigs and small earning opportunities'
	},
	{
		name: 'devopsjobs',
		category: 'Business',
		priority: 16,
		sortBy: 'new',
		timeframe: 'day',
		enabled: true,
		description: 'DevOps job postings'
	},
	{
		name: 'remotejs',
		category: 'Business',
		priority: 17,
		sortBy: 'new',
		timeframe: 'day',
		enabled: true,
		description: 'Remote JavaScript developer jobs'
	},
	{
		name: 'WorkOnline',
		category: 'Business',
		priority: 18,
		sortBy: 'new',
		timeframe: 'day',
		enabled: true,
		description: 'Remote work opportunities'
	},
	{
		name: 'hiring',
		category: 'Business',
		priority: 19,
		sortBy: 'new',
		timeframe: 'day',
		enabled: true,
		description: 'General hiring posts'
	},
	
	// ========================================
	// OPTIONAL - DISABLED BY DEFAULT
	// ========================================
	{
		name: 'BlockchainStartups',
		category: 'Business',
		priority: 20,
		sortBy: 'top',
		timeframe: 'week',
		enabled: false,
		description: 'Blockchain and Web3 startups (low activity)'
	}
];

/**
 * Get enabled subreddits sorted by priority
 */
export function getEnabledRedditFeeds(): RedditFeedConfig[] {
	return REDDIT_FEED_PRIORITIES
		.filter(feed => feed.enabled)
		.sort((a, b) => a.priority - b.priority);
}

/**
 * Get Reddit RSS URL from config
 */
export function getRedditRssUrl(config: RedditFeedConfig): string {
	const base = `https://www.reddit.com/r/${config.name}`;
	const sort = config.sortBy === 'top' 
		? `/top/.rss?t=${config.timeframe}`
		: `/${config.sortBy}/.rss`;
	return base + sort;
}

/**
 * Get subreddit config by name
 */
export function getSubredditConfig(name: string): RedditFeedConfig | undefined {
	return REDDIT_FEED_PRIORITIES.find(
		feed => feed.name.toLowerCase() === name.toLowerCase()
	);
}

/**
 * Session timeout configuration (30 minutes)
 */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Maximum number of posts to fetch per subreddit
 */
export const MAX_POSTS_PER_SUBREDDIT = 3;

