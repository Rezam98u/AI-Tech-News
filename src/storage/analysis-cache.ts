import { promises as fs } from 'fs';
import path from 'path';
import { Article, AnalysisResult } from '../types';
import { getArticleId } from './index';
import { logger } from '../logger';

const DATA_DIR = path.join(process.cwd(), 'data');
const ANALYSIS_CACHE_FILE = path.join(DATA_DIR, 'analysis-cache.json');

interface CachedAnalysis {
	articleId: string;
	analysis: AnalysisResult;
	timestamp: string;
	title: string; // For debugging/monitoring
}

interface AnalysisCache {
	[articleId: string]: CachedAnalysis;
}

async function ensureDataDir(): Promise<void> {
	await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadAnalysisCache(): Promise<AnalysisCache> {
	try {
		const raw = await fs.readFile(ANALYSIS_CACHE_FILE, 'utf8');
		return JSON.parse(raw) as AnalysisCache;
	} catch (err) {
		return {};
	}
}

export async function saveAnalysisCache(cache: AnalysisCache): Promise<void> {
	await ensureDataDir();
	const tmp = ANALYSIS_CACHE_FILE + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
	await fs.rename(tmp, ANALYSIS_CACHE_FILE);
}

export async function getCachedAnalysis(article: Article): Promise<AnalysisResult | null> {
	try {
		const cache = await loadAnalysisCache();
		const articleId = getArticleId(article);
		const cached = cache[articleId];
		
		if (cached) {
			logger.debug({ 
				title: article.title, 
				articleId,
				cacheTimestamp: cached.timestamp 
			}, 'analysis: using cached result');
			return cached.analysis;
		}
		
		return null;
	} catch (err) {
		logger.warn({ err }, 'failed to load cached analysis');
		return null;
	}
}

export async function cacheAnalysis(article: Article, analysis: AnalysisResult): Promise<void> {
	try {
		const cache = await loadAnalysisCache();
		const articleId = getArticleId(article);
		
		cache[articleId] = {
			articleId,
			analysis,
			timestamp: new Date().toISOString(),
			title: article.title
		};
		
		// Clean up old cache entries (keep only last 1000)
		const entries = Object.values(cache);
		if (entries.length > 1000) {
			entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
			const keepEntries = entries.slice(0, 1000);
			const newCache: AnalysisCache = {};
			keepEntries.forEach(entry => {
				newCache[entry.articleId] = entry;
			});
			await saveAnalysisCache(newCache);
			logger.info({ cleaned: entries.length - 1000 }, 'analysis cache: cleaned old entries');
		} else {
			await saveAnalysisCache(cache);
		}
		
		logger.debug({ 
			title: article.title, 
			articleId,
			cacheSize: Object.keys(cache).length 
		}, 'analysis: cached result');
		
	} catch (err) {
		logger.warn({ err }, 'failed to cache analysis');
	}
}

export async function getAnalysisCacheStats(): Promise<{
	totalCached: number;
	oldestEntry: string | null;
	newestEntry: string | null;
	cacheHitRate?: number;
}> {
	try {
		const cache = await loadAnalysisCache();
		const entries = Object.values(cache);
		
		if (entries.length === 0) {
			return {
				totalCached: 0,
				oldestEntry: null,
				newestEntry: null
			};
		}
		
		entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
		
		return {
			totalCached: entries.length,
			oldestEntry: entries[0]?.timestamp || null,
			newestEntry: entries[entries.length - 1]?.timestamp || null
		};
	} catch (err) {
		return {
			totalCached: 0,
			oldestEntry: null,
			newestEntry: null
		};
	}
}
