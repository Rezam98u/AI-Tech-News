import { Article, AnalysisResult } from '../types';
import { analyzeWithFallback } from './providers';
import { logger } from '../logger';
import { sanitizeAnalysisResult } from '../utils/sanitizer';

// Extended result type to include fallback flag
export interface AnalysisResultWithFallback extends AnalysisResult {
	isFallback?: boolean;
}

function coerceResult(obj: any): AnalysisResult {
	return {
		tldr: String(obj?.tldr ?? '').trim(),
		bullets: Array.isArray(obj?.bullets) ? obj.bullets.map((b: any) => String(b)) : [],
		business_implication: String(obj?.business_implication ?? '').trim(),
		target_audience: String(obj?.target_audience ?? '').trim(),
		description: String(obj?.description ?? '').trim(),
		hashtags: Array.isArray(obj?.hashtags) ? obj.hashtags.map((h: any) => String(h).replace('#', '')) : [],
	};
}

export async function analyzeArticle(article: Article, category?: string): Promise<AnalysisResultWithFallback> {
	try {
		// Use enhanced fallback analysis with automatic provider switching
		const parsed = await analyzeWithFallback(article, category, {
			maxRetries: 2,
			retryDelay: 1000,
			timeout: 30000
		});
		
		// Sanitize the result before processing
		const sanitized = sanitizeAnalysisResult(parsed);
		
		logger.info({ 
			title: article.title,
			hasDescription: !!sanitized.description,
			hashtagCount: sanitized.hashtags?.length || 0
		}, 'AI analysis completed successfully');
		
		return { ...coerceResult(sanitized), isFallback: false };
		
	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			title: article.title.substring(0, 50)
		}, 'AI analysis failed - all providers exhausted');
		
		// Return fallback analysis
		return {
			tldr: `Breaking: ${article.title}`,
			bullets: ['Key development in AI/tech space', 'Potential impact on businesses', 'Worth monitoring for updates'],
			business_implication: '', // No business implication for fallback
			target_audience: 'Business professionals, product managers, and tech leaders',
			description: `${article.title} - This latest development in the AI/tech space could have significant implications for businesses and professionals.`,
			hashtags: ['AI', 'TechNews', 'Innovation', 'Business', 'Technology', 'Update'],
			isFallback: true
		};
	}
}


