import Parser from 'rss-parser';
import axios from 'axios';
import { Article } from '../types';
import { logger } from '../logger';
import { filterByTimeRange } from '../utils/time';

const rssParser = new Parser();

export const DEFAULT_FEEDS: string[] = [
	'https://techcrunch.com/tag/artificial-intelligence/feed/',
	'https://openai.com/blog/rss.xml',
	'https://www.technologyreview.com/topic/artificial-intelligence/feed/',
	'https://www.wired.com/feed/rss',
	'https://venturebeat.com/category/ai/feed/',
	'https://www.theverge.com/rss/index.xml', // Main feed since AI-specific is 404
	// Product Hunt RSS removed due to 403 - consider API alternative
];

function toIsoString(dateLike: string | Date | undefined): string {
	try {
		if (!dateLike) return new Date().toISOString();
		const d = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
		return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
	} catch {
		return new Date().toISOString();
	}
}

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(err: any, url: string): string {
	if (axios.isAxiosError(err) && err.response) {
		const status = err.response.status;
		const domain = new URL(url).hostname;
		switch (status) {
			case 429: return `Rate limited by ${domain} - too many requests`;
			case 403: return `Access forbidden by ${domain} - may need authentication`;
			case 404: return `RSS feed not found at ${domain} - URL may be outdated`;
			case 500: return `Server error at ${domain} - temporary issue`;
			default: return `HTTP ${status} error from ${domain}`;
		}
	}
	return `Network error from ${new URL(url).hostname}: ${err.message || 'Unknown error'}`;
}

export async function fetchRssFeed(url: string): Promise<Article[]> {
	const maxRetries = 2;
	let retryDelay = 2000; // Start with 2 seconds
	
	// First try with rss-parser
	try {
		const feed = await rssParser.parseURL(url);
		const items = (feed.items || []).map((item) => ({
			title: item.title ?? 'Untitled',
			link: item.link ?? '',
			contentSnippet: (item.contentSnippet || item.content || '').toString().trim(),
			pubDate: toIsoString(item.isoDate || (item.pubDate as string | undefined)),
		}));
		logger.debug({ url, count: items.length }, 'fetched feed');
		return items;
	} catch (err) {
		logger.warn({ url, error: getErrorMessage(err, url) }, 'parseURL failed, retrying with axios');
	}

	// Fallback to axios with retries for 429 errors
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const res = await axios.get(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; TheAIPipelineBot/1.0; +https://github.com/ai-pipeline-bot)',
					'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
				},
				timeout: 15000,
			});
			
			const feed = await rssParser.parseString(res.data);
			const items = (feed.items || []).map((item) => ({
				title: item.title ?? 'Untitled',
				link: item.link ?? '',
				contentSnippet: (item.contentSnippet || item.content || '').toString().trim(),
				pubDate: toIsoString(item.isoDate || (item.pubDate as string | undefined)),
			}));
			logger.debug({ url, count: items.length, attempt }, 'fetched feed (axios fallback)');
			return items;
			
		} catch (err2) {
			const errorMsg = getErrorMessage(err2, url);
			
			// Handle 429 rate limit with retry
			if (axios.isAxiosError(err2) && err2.response?.status === 429 && attempt < maxRetries) {
				const retryAfter = err2.response.headers['retry-after'];
				const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : retryDelay;
				logger.warn({ url, attempt, waitTime: waitTime / 1000 }, `Rate limited, retrying in ${waitTime / 1000}s`);
				await delay(waitTime);
				retryDelay *= 2; // Exponential backoff
				continue;
			}
			
			// Log final error and return empty array
			if (attempt === maxRetries) {
				logger.error({ url, error: errorMsg, attempts: attempt + 1 }, 'failed to fetch feed after retries');
				return [];
			}
		}
	}
	
	return [];
}

export async function fetchAllArticles(feedUrls: string[] = DEFAULT_FEEDS, options?: { maxAgeHours?: number }): Promise<Article[]> {
	const articles: Article[] = [];
	
	// Fetch feeds sequentially with delays to avoid rate limits
	for (let i = 0; i < feedUrls.length; i++) {
		const url = feedUrls[i]!;
		const feedArticles = await fetchRssFeed(url);
		articles.push(...feedArticles);
		
		// Add delay between feeds (except for the last one)
		if (i < feedUrls.length - 1) {
			await delay(1000); // 1 second delay between feeds
		}
	}
	
	// Optional max age filter first
	const filtered = typeof options?.maxAgeHours === 'number' ? filterByTimeRange(articles, options.maxAgeHours) : articles;
	// Sort newest first via ISO string compare
	filtered.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
	logger.info({ total: filtered.length, maxAgeHours: options?.maxAgeHours, feedCount: feedUrls.length }, 'aggregated articles');
	return filtered;
}

export async function getRecentArticles(hours: number, feedUrls: string[] = DEFAULT_FEEDS): Promise<Article[]> {
	return fetchAllArticles(feedUrls, { maxAgeHours: hours });
}


