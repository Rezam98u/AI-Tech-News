import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Article } from '../types';

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'posted.json');

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
}


