/**
 * Persian language utilities for AI Tech News Bot
 */

/**
 * Detects if text contains Persian characters
 */
export function isPersianText(text: string): boolean {
	const persianRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
	return persianRegex.test(text);
}

/**
 * Checks if business impact content is valuable and substantial
 * Supports both English and Persian language validation
 */
export function isValuableBusinessImpact(businessImpact: string, isPersian: boolean = false): boolean {
	if (!businessImpact || businessImpact.length < 30) return false;
	
	const lowerImpact = businessImpact.toLowerCase();
	
	// Check for vague phrases based on language
	const vagueEnglishPhrases = [
		'no clear business impact',
		'minor impact',
		'limited business',
		'general impact',
		'potential impact'
	];
	
	const vaguePersianPhrases = [
		'تأثیر کسب‌وکار واضحی ندارد',
		'تأثیر جزئی',
		'کسب‌وکار محدود',
		'تأثیر عمومی',
		'تأثیر بالقوه'
	];
	
	// Check if contains vague phrases
	const vaguePhrasesToCheck = isPersian ? vaguePersianPhrases : vagueEnglishPhrases;
	const hasVaguePhrase = vaguePhrasesToCheck.some(phrase => lowerImpact.includes(phrase));
	
	if (hasVaguePhrase) return false;
	
	// Check for meaningful business keywords based on language
	const englishKeywords = [
		'revenue', 'cost', 'profit', 'market', 'competitive',
		'strategy', 'acquisition', 'funding', 'pricing', 'partnership'
	];
	
	const persianKeywords = [
		'درآمد', 'هزینه', 'سود', 'بازار', 'رقابتی',
		'استراتژی', 'خرید', 'تأمین مالی', 'قیمت', 'مشارکت'
	];
	
	// Check if contains meaningful keywords
	const keywordsToCheck = isPersian ? persianKeywords : englishKeywords;
	const hasMeaningfulKeyword = keywordsToCheck.some(keyword => lowerImpact.includes(keyword));
	
	return hasMeaningfulKeyword;
}

/**
 * Persian language labels for business sections
 */
export const PersianLabels = {
	BUSINESS_IMPACT: '💼 <b>تأثیر کسب‌وکار:</b>',
	BUSINESS_IMPACT_MARKDOWN: '💼 **تأثیر کسب‌وکار:**',
	TARGET_AUDIENCE: 'متخصصان کسب‌وکار، مدیران محصول، و رهبران فناوری',
	FALLBACK_BULLETS: [
		'تحول کلیدی در حوزه هوش مصنوعی/فناوری',
		'تأثیر بالقوه بر کسب‌وکارها',
		'ارزش پیگیری برای به‌روزرسانی‌ها'
	],
	FALLBACK_DESCRIPTION_SUFFIX: 'این آخرین تحولات می‌تواند تأثیرات مهمی بر صنعت فناوری و کسب‌وکارها داشته باشد.',
	FALLBACK_HASHTAGS: ['هوش_مصنوعی', 'اخبار_فناوری', 'نوآوری', 'کسب_وکار', 'فناوری', 'به_روزرسانی']
} as const;

/**
 * English language labels for business sections
 */
export const EnglishLabels = {
	BUSINESS_IMPACT: '💼 <b>Business Impact:</b>',
	BUSINESS_IMPACT_MARKDOWN: '💼 **Business Impact:**',
	TARGET_AUDIENCE: 'Business professionals, product managers, and tech leaders',
	FALLBACK_BULLETS: [
		'Key development in AI/tech space',
		'Potential impact on businesses',
		'Worth monitoring for updates'
	],
	FALLBACK_DESCRIPTION_SUFFIX: 'This latest development in the AI/tech space could have significant implications for businesses and professionals.',
	FALLBACK_HASHTAGS: ['AI', 'TechNews', 'Innovation', 'Business', 'Technology', 'Update']
} as const;

/**
 * Gets appropriate labels based on language
 */
export function getLabels(isPersian: boolean) {
	return isPersian ? PersianLabels : EnglishLabels;
}

/**
 * Gets appropriate labels based on language and format
 */
export function getLabelsForFormat(isPersian: boolean, format: 'html' | 'markdown') {
	const labels = isPersian ? PersianLabels : EnglishLabels;
	
	if (format === 'markdown') {
		return {
			...labels,
			BUSINESS_IMPACT: labels.BUSINESS_IMPACT_MARKDOWN
		};
	}
	
	return labels;
}

/**
 * Preserve English technical terms in Persian text for HTML
 */
export function preserveEnglishInPersian(text: string): string {
	// Common AI/tech terms that should remain in English
	const technicalTerms = [
		'AI', 'API', 'ML', 'OpenAI', 'GitHub', 'ChatGPT', 'GPT', 
		'LLM', 'NLP', 'MLOps', 'DevOps', 'SaaS', 'PaaS', 'IaaS',
		'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'React',
		'Python', 'JavaScript', 'TypeScript', 'Node.js', 'TensorFlow',
		'PyTorch', 'Transformer', 'BERT', 'Neural Network', 'Deep Learning',
		'Machine Learning', 'Artificial Intelligence', 'API key'
	];
	
	let preservedText = text;
	
	// Preserve technical terms
	technicalTerms.forEach(term => {
		const regex = new RegExp(`\\b${term}\\b`, 'gi');
		preservedText = preservedText.replace(regex, (match) => `<code>${match}</code>`);
	});
	
	return preservedText;
}

/**
 * Apply Persian punctuation and formatting rules for HTML
 */
export function formatPersianText(text: string): string {
	let formatted = text;
	
	// Apply Persian punctuation
	formatted = formatted
		.replace(/,/g, '،')          // Persian comma
		.replace(/;/g, '؛')          // Persian semicolon
		.replace(/\?/g, '؟');        // Persian question mark
	
	// Handle mixed RTL/LTR text (preserve English terms in code tags)
	formatted = preserveEnglishInPersian(formatted);
	
	return formatted;
}

/**
 * Check if text contains mixed RTL/LTR content
 */
export function hasMixedContent(text: string): boolean {
	const persianRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
	const englishRegex = /[a-zA-Z]/;
	
	return persianRegex.test(text) && englishRegex.test(text);
}

/**
 * Format business impact text for HTML with language-specific styling
 */
export function formatBusinessImpactHtml(businessImpact: string, isPersian: boolean): string {
	if (!businessImpact?.trim()) return '';
	
	const labels = getLabels(isPersian);
	let formatted = businessImpact;
	
	if (isPersian) {
		formatted = formatPersianText(formatted);
	}
	
	return `\n\n${labels.BUSINESS_IMPACT} ${formatted}`;
}
