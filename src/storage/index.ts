import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Article } from '../types';

interface LastPostedArticle {
	article: Article;
	postedAt: string; // ISO 8601 timestamp
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'posted.json');
const LAST_POST_FILE = path.join(DATA_DIR, 'last-post.json');

async function ensureDataDir(): Promise<void> {
	await fs.mkdir(DATA_DIR, { recursive: true });
}

function computeArticleIdentity(article: Article): string {
	const base = article.link && article.link.trim().length > 0
		? article.link.trim()
		: `${article.title}|${article.pubDate}`;
	return crypto.createHash('sha256').update(base).digest('hex');
}

export function getArticleId(article: Article): string {
	return computeArticleIdentity(article);
}

export async function loadPostedIds(): Promise<Set<string>> {
	try {
		const raw = await fs.readFile(STORE_FILE, 'utf8');
		const arr = JSON.parse(raw) as string[];
		return new Set(arr);
	} catch (err: unknown) {
		return new Set();
	}
}

export async function savePostedIds(ids: Set<string>): Promise<void> {
	await ensureDataDir();
	const arr = Array.from(ids);
	const tmp = STORE_FILE + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf8');
	await fs.rename(tmp, STORE_FILE);
}

export async function filterNewArticles(articles: Article[], options?: { maxAgeHours?: number }): Promise<Article[]> {
	const seen = await loadPostedIds();
	let out = articles.filter((a) => !seen.has(getArticleId(a)));
	if (typeof options?.maxAgeHours === 'number') {
		const cutoff = Date.now() - options.maxAgeHours * 3600 * 1000;
		out = out.filter((a) => {
			const d = new Date(a.pubDate);
			return !isNaN(d.getTime()) && d.getTime() >= cutoff;
		});
	}
	return out;
}

export async function markArticlesPosted(articles: Article[]): Promise<void> {
	if (articles.length === 0) return;
	const seen = await loadPostedIds();
	for (const a of articles) {
		seen.add(getArticleId(a));
	}
	await savePostedIds(seen);
	
	// Save the latest article as the last posted one
	if (articles.length > 0) {
		// Sort by publication date to get the most recent
		const sortedArticles = [...articles].sort((a, b) => b.pubDate.localeCompare(a.pubDate));
		const latestArticle = sortedArticles[0];
		if (latestArticle) {
			await saveLastPostedArticle(latestArticle);
		}
	}
}

/**
 * Save the last posted article with timestamp
 */
export async function saveLastPostedArticle(article: Article): Promise<void> {
	await ensureDataDir();
	const lastPost: LastPostedArticle = {
		article,
		postedAt: new Date().toISOString()
	};
	const tmp = LAST_POST_FILE + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(lastPost, null, 2), 'utf8');
	await fs.rename(tmp, LAST_POST_FILE);
}

/**
 * Get the last posted article with timestamp
 */
export async function getLastPostedArticle(): Promise<LastPostedArticle | null> {
	try {
		const raw = await fs.readFile(LAST_POST_FILE, 'utf8');
		return JSON.parse(raw) as LastPostedArticle;
	} catch (err: unknown) {
		return null;
	}
}


