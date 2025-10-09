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
	expiresAt?: string; // Optional expiration timestamp
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
			// Check if cache has expired
			if (cached.expiresAt) {
				const expiresAt = new Date(cached.expiresAt);
				const now = new Date();
				
				if (now > expiresAt) {
					logger.debug({ 
						title: article.title, 
						articleId,
						expiredAt: cached.expiresAt 
					}, 'analysis: cache expired, will fetch new analysis');
					return null;
				}
			}
			
			logger.debug({ 
				title: article.title, 
				articleId,
				cacheTimestamp: cached.timestamp,
				expiresAt: cached.expiresAt || 'never'
			}, 'analysis: using cached result');
			return cached.analysis;
		}
		
		return null;
	} catch (err) {
		logger.warn({ err }, 'failed to load cached analysis');
		return null;
	}
}

export async function cacheAnalysis(
	article: Article, 
	analysis: AnalysisResult, 
	ttlHours: number = 24 * 7 // Default: 7 days
): Promise<void> {
	try {
		const cache = await loadAnalysisCache();
		const articleId = getArticleId(article);
		const now = new Date();
		
		// Calculate expiration time
		const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
		
		cache[articleId] = {
			articleId,
			analysis,
			timestamp: now.toISOString(),
			title: article.title,
			expiresAt: expiresAt.toISOString()
		};
		
		// Clean up old and expired cache entries
		const entries = Object.values(cache);
		
		// Remove expired entries first
		const validEntries = entries.filter(entry => {
			if (!entry.expiresAt) return true; // Keep entries without expiration
			return new Date(entry.expiresAt) > now;
		});
		
		// Keep only the 1000 most recent valid entries
		if (validEntries.length > 1000) {
			validEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
			const keepEntries = validEntries.slice(0, 1000);
			const newCache: AnalysisCache = {};
			keepEntries.forEach(entry => {
				newCache[entry.articleId] = entry;
			});
			await saveAnalysisCache(newCache);
			logger.info({ 
				expired: entries.length - validEntries.length,
				cleaned: validEntries.length - 1000,
				total: keepEntries.length
			}, 'analysis cache: cleaned expired and old entries');
		} else if (validEntries.length < entries.length) {
			// Just remove expired entries
			const newCache: AnalysisCache = {};
			validEntries.forEach(entry => {
				newCache[entry.articleId] = entry;
			});
			await saveAnalysisCache(newCache);
			logger.info({ 
				expired: entries.length - validEntries.length,
				remaining: validEntries.length
			}, 'analysis cache: cleaned expired entries');
		} else {
			await saveAnalysisCache(cache);
		}
		
		logger.debug({ 
			title: article.title, 
			articleId,
			cacheSize: Object.keys(cache).length,
			expiresAt: expiresAt.toISOString(),
			ttlHours
		}, 'analysis: cached result with TTL');
		
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
