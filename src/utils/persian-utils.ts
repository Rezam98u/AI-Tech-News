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
	BUSINESS_IMPACT: '💼 **تأثیر کسب‌وکار:**',
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
	BUSINESS_IMPACT: '💼 **Business Impact:**',
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
