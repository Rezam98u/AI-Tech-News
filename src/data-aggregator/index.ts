import Parser from 'rss-parser';
import axios from 'axios';
import { Article } from '../types';
import { logger } from '../logger';

const rssParser = new Parser();

export const DEFAULT_FEEDS: string[] = [
	'https://techcrunch.com/tag/artificial-intelligence/feed/',
	'https://openai.com/blog/rss.xml',
	'https://www.technologyreview.com/topic/artificial-intelligence/feed/',
	'https://www.wired.com/feed/rss',
	'https://venturebeat.com/category/ai/feed/',
	'https://www.theverge.com/ai/rss/index.xml',
	'https://www.producthunt.com/feed',
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

export async function fetchRssFeed(url: string): Promise<Article[]> {
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
		logger.warn({ url, err }, 'parseURL failed, retrying with axios');
		try {
			const res = await axios.get(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; TheAIPipelineBot/1.0; +https://example.com)',
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
			logger.debug({ url, count: items.length }, 'fetched feed (axios fallback)');
			return items;
		} catch (err2) {
			logger.error({ url, err: err2 }, 'failed to fetch feed');
			return [];
		}
	}
}

export async function fetchAllArticles(feedUrls: string[] = DEFAULT_FEEDS): Promise<Article[]> {
	const results = await Promise.allSettled(feedUrls.map((u) => fetchRssFeed(u)));
	const articles: Article[] = [];
	for (const r of results) {
		if (r.status === 'fulfilled') {
			articles.push(...r.value);
		}
	}
	// Sort newest first. ISO date strings compare chronologically lexicographically.
	articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
	logger.info({ total: articles.length }, 'aggregated articles');
	return articles;
}


