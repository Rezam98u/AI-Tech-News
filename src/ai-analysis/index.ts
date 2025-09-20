import { Article, AnalysisResult } from '../types';
import { AIProviderFactory, detectAIProvider, buildEnhancedPrompt } from './providers';
import { logger } from '../logger';

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

export async function analyzeArticle(article: Article, translateToPersian: boolean = true): Promise<AnalysisResultWithFallback> {
	try {
		// Detect and configure AI provider
		const config = detectAIProvider();
		logger.info({ provider: config.provider, model: config.model, translateToPersian }, 'Using AI provider for analysis');
		
		const provider = AIProviderFactory.createProvider(config);
		const prompt = buildEnhancedPrompt(article, translateToPersian);
		
		// Analyze with the selected provider
		const parsed = await provider.analyze(prompt);
		logger.info({ 
			provider: config.provider, 
			title: article.title,
			hasDescription: !!parsed.description,
			hashtagCount: parsed.hashtags?.length || 0,
			translateToPersian
		}, 'AI analysis completed successfully');
		
		return { ...coerceResult(parsed), isFallback: false };
		
	} catch (err) {
		logger.error({ err: err instanceof Error ? err.message : String(err), translateToPersian }, 'AI analysis failed');
		
		// Return fallback analysis based on language
		if (translateToPersian) {
			return {
				tldr: `اخبار: ${article.title}`,
				bullets: ['تحول کلیدی در حوزه هوش مصنوعی/فناوری', 'تأثیر بالقوه بر کسب‌وکارها', 'ارزش پیگیری برای به‌روزرسانی‌ها'],
				business_implication: '', // No business implication for fallback
				target_audience: 'متخصصان کسب‌وکار، مدیران محصول، و رهبران فناوری',
				description: `${article.title} - این آخرین تحولات می‌تواند تأثیرات مهمی بر صنعت فناوری و کسب‌وکارها داشته باشد.`,
				hashtags: ['هوش_مصنوعی', 'اخبار_فناوری', 'نوآوری', 'کسب_وکار', 'فناوری', 'به_روزرسانی'],
				isFallback: true
			};
		} else {
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
}


