import { Article, AnalysisResult } from '../types';
import { analyzeWithFallback } from './langchain-providers';
import { logger } from '../logger';

// Extended result type to include fallback flag
export interface AnalysisResultWithFallback extends AnalysisResult {
	isFallback?: boolean;
}

export async function analyzeArticle(article: Article, category?: string): Promise<AnalysisResultWithFallback> {
	try {
		// Use LangChain-based analysis with automatic provider switching and structured output
		const result = await analyzeWithFallback(article, category, {
			maxRetries: 2,
			retryDelay: 1000,
			timeout: 30000
		});
		
		logger.info({ 
			title: article.title,
			hasDescription: !!result.description,
			hashtagCount: result.hashtags?.length || 0
		}, 'AI analysis completed successfully (LangChain)');
		
		// Result is already validated and type-safe from LangChain
		return { ...result, isFallback: false };
		
	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			title: article.title.substring(0, 50)
		}, 'AI analysis failed - all providers exhausted (LangChain)');
		
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


