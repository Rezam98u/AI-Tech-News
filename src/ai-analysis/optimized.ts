import { Article, AnalysisResult } from '../types';
import { analyzeArticle, AnalysisResultWithFallback } from './index';
import { getCachedAnalysis, cacheAnalysis } from '../storage/analysis-cache';
import { logger } from '../logger';

// Performance tracking
interface AnalysisMetrics {
	totalRequests: number;
	cacheHits: number;
	cacheMisses: number;
	apiCalls: number;
	totalLatency: number;
	errors: number;
}

let metrics: AnalysisMetrics = {
	totalRequests: 0,
	cacheHits: 0,
	cacheMisses: 0,
	apiCalls: 0,
	totalLatency: 0,
	errors: 0
};

/**
 * Optimized analysis that uses caching and on-demand processing
 */
export async function getOptimizedAnalysis(article: Article, options?: {
	forceRefresh?: boolean;
	priority?: 'low' | 'normal' | 'high';
	category?: string;
}): Promise<AnalysisResultWithFallback> {
	const startTime = Date.now();
	metrics.totalRequests++;
	
	try {
		// Check cache first (unless force refresh)
		if (!options?.forceRefresh) {
			const cached = await getCachedAnalysis(article);
			if (cached) {
				metrics.cacheHits++;
				metrics.totalLatency += Date.now() - startTime;
				return cached;
			}
		}
		
		metrics.cacheMisses++;
		
		// Perform AI analysis
		logger.info({ 
			title: article.title,
			priority: options?.priority || 'normal',
			category: options?.category,
			forceRefresh: options?.forceRefresh || false
		}, 'analysis: performing AI analysis');
		
		const analysis = await analyzeArticle(article, options?.category);
		metrics.apiCalls++;
		
		// Cache the result (7 days for regular analysis)
		await cacheAnalysis(article, analysis, 24 * 7);
		
		metrics.totalLatency += Date.now() - startTime;
		
		logger.info({ 
			title: article.title,
			latency: Date.now() - startTime,
			hasDescription: !!analysis.description,
			hashtagCount: analysis.hashtags.length
		}, 'analysis: completed and cached');
		
		return analysis;
		
	} catch (err) {
		metrics.errors++;
		metrics.totalLatency += Date.now() - startTime;
		
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			title: article.title,
			latency: Date.now() - startTime
		}, 'analysis: failed, using fallback');
		
		// Return fallback analysis
		const fallback: AnalysisResultWithFallback = {
			tldr: `Latest: ${article.title}`,
			bullets: ['Important development in AI/tech', 'Could impact businesses and professionals', 'Worth monitoring for updates'],
			business_implication: 'This development may have implications for how businesses operate in the AI/tech sector.',
			target_audience: 'Business professionals, product managers, and technology leaders',
			description: `${article.title} - This latest development could have significant implications for the tech industry and businesses.`,
			hashtags: ['AI', 'TechNews', 'Innovation', 'Business', 'Technology', 'Breaking'],
			isFallback: true
		};
		
		// Cache fallback to avoid repeated failures (shorter TTL: 1 hour)
		await cacheAnalysis(article, fallback, 1);
		return fallback;
	}
}

/**
 * Batch analysis for multiple articles (with rate limiting)
 */
export async function getBatchAnalysis(
	articles: Article[], 
	options?: {
		maxConcurrent?: number;
		delayBetween?: number;
		priority?: 'low' | 'normal' | 'high';
	}
): Promise<Map<string, AnalysisResult>> {
	const results = new Map<string, AnalysisResult>();
	const maxConcurrent = options?.maxConcurrent || 3;
	const delayBetween = options?.delayBetween || 1000; // 1 second delay
	
	logger.info({ 
		articleCount: articles.length,
		maxConcurrent,
		delayBetween 
	}, 'analysis: starting batch processing');
	
	// Process in chunks to avoid overwhelming the API
	for (let i = 0; i < articles.length; i += maxConcurrent) {
		const chunk = articles.slice(i, i + maxConcurrent);
		
		const chunkPromises = chunk.map(async (article) => {
			const analysis = await getOptimizedAnalysis(article, options);
			results.set(article.link, analysis);
		});
		
		await Promise.all(chunkPromises);
		
		// Delay between chunks (except for the last one)
		if (i + maxConcurrent < articles.length) {
			await new Promise(resolve => setTimeout(resolve, delayBetween));
		}
	}
	
	logger.info({ 
		processed: results.size,
		total: articles.length 
	}, 'analysis: batch processing completed');
	
	return results;
}

/**
 * Smart analysis that only analyzes when needed for posting
 */
export async function getPostReadyAnalysis(article: Article, category?: string): Promise<AnalysisResultWithFallback> {
	logger.info({ title: article.title, category }, 'analysis: preparing article for posting');
	
	return await getOptimizedAnalysis(article, { 
		priority: 'high', // High priority for posts being published
		...(category && { category })
	});
}

/**
 * Get performance metrics
 */
export function getAnalysisMetrics(): AnalysisMetrics & {
	cacheHitRate: number;
	avgLatency: number;
	errorRate: number;
} {
	const cacheHitRate = metrics.totalRequests > 0 
		? (metrics.cacheHits / metrics.totalRequests) * 100 
		: 0;
	
	const avgLatency = metrics.totalRequests > 0 
		? metrics.totalLatency / metrics.totalRequests 
		: 0;
	
	const errorRate = metrics.totalRequests > 0 
		? (metrics.errors / metrics.totalRequests) * 100 
		: 0;
	
	return {
		...metrics,
		cacheHitRate,
		avgLatency,
		errorRate
	};
}

/**
 * Reset metrics (useful for monitoring)
 */
export function resetAnalysisMetrics(): void {
	metrics = {
		totalRequests: 0,
		cacheHits: 0,
		cacheMisses: 0,
		apiCalls: 0,
		totalLatency: 0,
		errors: 0
	};
	logger.info('analysis: metrics reset');
}
