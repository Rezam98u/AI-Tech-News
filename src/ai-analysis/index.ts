import { Article, AnalysisResult } from '../types';
import { AIProviderFactory, detectAIProvider, buildEnhancedPrompt } from './providers';
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

export async function analyzeArticle(article: Article): Promise<AnalysisResultWithFallback> {
	try {
		// Detect and configure AI provider
		const config = detectAIProvider();
		logger.info({ provider: config.provider, model: config.model }, 'Using AI provider for analysis');
		
		const provider = AIProviderFactory.createProvider(config);
		const prompt = buildEnhancedPrompt(article);
		
		// Analyze with the selected provider
		const parsed = await provider.analyze(prompt);
		
		// Sanitize the result before processing
		const sanitized = sanitizeAnalysisResult(parsed);
		
		logger.info({ 
			provider: config.provider, 
			title: article.title,
			hasDescription: !!sanitized.description,
			hashtagCount: sanitized.hashtags?.length || 0
		}, 'AI analysis completed successfully');
		
		return { ...coerceResult(sanitized), isFallback: false };
		
	} catch (err) {
		logger.error({ err: err instanceof Error ? err.message : String(err) }, 'AI analysis failed');
		
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


