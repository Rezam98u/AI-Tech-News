/**
 * HTML formatting utilities for Telegram HTML parse mode
 * Supports Persian language, character limits, and thread splitting
 */

import { logger } from '../logger';

/**
 * Character limits for different Telegram message types
 */
export const LIMITS = {
	SINGLE_POST: 900,          // Target for single posts
	THREAD_POST: 800,          // Target for thread posts  
	CAPTION_WITH_PHOTO: 1024,  // Telegram limit for photo captions
	MAX_MESSAGE: 4096,         // Telegram absolute limit
} as const;

/**
 * HTML entities that need to be escaped for safe HTML content
 */
const HTML_ENTITIES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#x27;',
	'/': '&#x2F;',
} as const;

/**
 * Safely escape HTML content to prevent injection and formatting issues
 */
export function htmlEscape(text: string): string {
	return text.replace(/[&<>"'/]/g, (match) => HTML_ENTITIES[match] || match);
}

/**
 * Calculate text length excluding HTML tags for accurate character counting
 */
export function calculateHtmlLength(htmlText: string): number {
	// Remove HTML tags and decode entities
	const withoutTags = htmlText.replace(/<[^>]*>/g, '');
	
	// Decode common HTML entities
	const withoutEntities = withoutTags
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#x2F;/g, '/');
	
	return withoutEntities.length;
}

/**
 * Convert common Markdown formatting to HTML
 */
export function markdownToHtml(text: string): string {
	let html = text;
	
	// Convert **bold** to <b>bold</b>
	html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
	
	// Convert *italic* to <i>italic</i>
	html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');
	
	// Convert `code` to <code>code</code>
	html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
	
	// Convert [text](url) to <a href="url">text</a>
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
	
	return html;
}

/**
 * Smart text truncation at word boundaries for better readability
 */
export function smartTruncate(text: string, maxLength: number, suffix: string = '...'): string {
	if (text.length <= maxLength) return text;
	
	const truncateAt = maxLength - suffix.length;
	
	// Try to truncate at word boundary
	const spaceIndex = text.lastIndexOf(' ', truncateAt);
	const truncatedText = spaceIndex > truncateAt * 0.8 
		? text.substring(0, spaceIndex)
		: text.substring(0, truncateAt);
	
	return truncatedText + suffix;
}

/**
 * Split long content into threaded messages while preserving formatting
 */
export function splitIntoThreads(content: string, maxLength: number = LIMITS.THREAD_POST): { messages: string[], totalLength: number } {
	const contentLength = calculateHtmlLength(content);
	
	if (contentLength <= maxLength) {
		return { messages: [content], totalLength: contentLength };
	}
	
	logger.info({ 
		contentLength, 
		maxLength,
		willSplit: true 
	}, 'Splitting content into thread messages');
	
	const messages: string[] = [];
	let remaining = content;
	let messageIndex = 1;
	
	while (remaining.length > 0) {
		const remainingLength = calculateHtmlLength(remaining);
		
		if (remainingLength <= maxLength) {
			// Last message - add thread indicator if it's not the first
			const finalMessage = messageIndex > 1 
				? `🧵 ${messageIndex}/${messageIndex}\n\n${remaining}`
				: remaining;
			messages.push(finalMessage);
			break;
		}
		
		// Find a good split point
		let splitPoint = maxLength - 100; // Leave room for thread indicator
		
		// Try to find a natural break point (double newline, sentence end)
		const naturalBreaks = ['\n\n', '. ', '! ', '? '];
		let bestSplit = splitPoint;
		
		for (const breakPattern of naturalBreaks) {
			const lastBreak = remaining.lastIndexOf(breakPattern, splitPoint);
			if (lastBreak > splitPoint * 0.6) { // Don't break too early
				bestSplit = lastBreak + breakPattern.length;
				break;
			}
		}
		
		// Extract this message
		const messageContent = remaining.substring(0, bestSplit).trim();
		const threadMessage = `🧵 ${messageIndex}/?\n\n${messageContent}`;
		messages.push(threadMessage);
		
		// Update remaining content
		remaining = remaining.substring(bestSplit).trim();
		messageIndex++;
	}
	
	// Update thread indicators with final count
	const finalCount = messages.length;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]!.startsWith('🧵')) {
			messages[i] = messages[i]!.replace('/?', `/${finalCount}`);
		}
	}
	
	const totalLength = messages.reduce((sum, msg) => sum + calculateHtmlLength(msg), 0);
	
	logger.info({ 
		originalLength: contentLength,
		finalMessageCount: finalCount,
		totalLength,
		averageLength: Math.round(totalLength / finalCount)
	}, 'Content split into thread messages');
	
	return { messages, totalLength };
}

/**
 * Check if content is in Persian based on character analysis
 */
export function isPersianContent(text: string): boolean {
	const persianRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
	const persianChars = (text.match(persianRegex) || []).length;
	const totalChars = text.replace(/\s/g, '').length;
	
	// Consider it Persian if more than 20% of non-space characters are Persian
	return totalChars > 0 && (persianChars / totalChars) > 0.2;
}

/**
 * Preserve English technical terms within Persian text
 */
export function preserveEnglishTerms(text: string): string {
	// Common AI/tech terms that should remain in English
	const technicalTerms = [
		'AI', 'API', 'ML', 'OpenAI', 'GitHub', 'ChatGPT', 'GPT', 
		'LLM', 'NLP', 'MLOps', 'DevOps', 'SaaS', 'PaaS', 'IaaS',
		'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'React',
		'Python', 'JavaScript', 'TypeScript', 'Node.js', 'TensorFlow',
		'PyTorch', 'Transformer', 'BERT', 'Neural Network', 'Deep Learning'
	];
	
	let preservedText = text;
	
	// Wrap English terms to preserve them during translation
	technicalTerms.forEach(term => {
		const regex = new RegExp(`\\b${term}\\b`, 'gi');
		preservedText = preservedText.replace(regex, `[PRESERVE:${term}]`);
	});
	
	return preservedText;
}

/**
 * Build an HTML formatted post with proper structure
 */
export interface HtmlPostOptions {
	tldr: string;
	bullets?: string[];
	businessImpact?: string;
	description: string;
	hashtags?: string[];
	timeAgo: string;
	link: string;
	isPersian?: boolean;
	maxLength?: number;
}

export function buildHtmlPost(options: HtmlPostOptions): string {
	const {
		tldr, bullets = [], businessImpact, description,
		hashtags = [], timeAgo, link, isPersian = false,
		maxLength = LIMITS.SINGLE_POST
	} = options;
	
	// Build sections with HTML formatting
	const tldrSection = `<b>💡 ${htmlEscape(tldr)}</b>`;
	
	const bulletsSection = bullets.length > 0
		? '\n\n' + bullets.map(bullet => `🔸 ${htmlEscape(bullet)}`).join('\n')
		: '';
	
	const businessSection = businessImpact && businessImpact.trim()
		? `\n\n<b>💼 ${isPersian ? 'تأثیر کسب‌وکار:' : 'Business Impact:'}</b> ${htmlEscape(businessImpact)}`
		: '';
	
	const descriptionSection = `\n\n${htmlEscape(description)}`;
	
	const hashtagsSection = hashtags.length > 0
		? '\n\n' + hashtags.map(tag => `#${tag}`).join(' ')
		: '';
	
	// Try to get domain from URL for link display
	let linkDisplay = link;
	try {
		const url = new URL(link);
		linkDisplay = url.hostname.replace(/^www\./, '');
	} catch {
		// Use full URL if parsing fails
	}
	
	const footerSection = `\n\n⏰ ${htmlEscape(timeAgo)}\n🔗 <a href="${link}">${htmlEscape(linkDisplay)}</a>`;
	
	// Combine all sections
	const fullPost = tldrSection + bulletsSection + businessSection + 
					 descriptionSection + hashtagsSection + footerSection;
	
	const actualLength = calculateHtmlLength(fullPost);
	
	// If too long, try to optimize
	if (actualLength > maxLength) {
		logger.info({
			actualLength,
			maxLength,
			needsOptimization: true
		}, 'Post exceeds length limit, optimizing');
		
		// Try removing business impact first
		if (businessImpact) {
			const withoutBusiness = tldrSection + bulletsSection + 
								   descriptionSection + hashtagsSection + footerSection;
			if (calculateHtmlLength(withoutBusiness) <= maxLength) {
				return withoutBusiness;
			}
		}
		
		// Try reducing bullets
		if (bullets.length > 3) {
			const reducedBullets = bullets.slice(0, 3);
			const reducedBulletsSection = '\n\n' + reducedBullets.map(bullet => `🔸 ${htmlEscape(bullet)}`).join('\n');
			const withReducedBullets = tldrSection + reducedBulletsSection + 
									   descriptionSection + hashtagsSection + footerSection;
			
			if (calculateHtmlLength(withReducedBullets) <= maxLength) {
				return withReducedBullets;
			}
		}
		
		// Last resort: truncate description
		const availableForDescription = maxLength - calculateHtmlLength(
			tldrSection + bulletsSection + hashtagsSection + footerSection
		) - 10; // Safety margin
		
		const truncatedDescription = smartTruncate(description, availableForDescription);
		return tldrSection + bulletsSection + `\n\n${htmlEscape(truncatedDescription)}` + 
			   hashtagsSection + footerSection;
	}
	
	return fullPost;
}

/**
 * Format content for Persian language with proper RTL handling
 */
export function formatPersianHtml(content: string): string {
	// Preserve English technical terms
	const preservedContent = preserveEnglishTerms(content);
	
	// Apply RTL text direction for Persian content
	// Note: Telegram handles RTL automatically, but we can add markers if needed
	
	// Restore preserved English terms
	let finalContent = preservedContent.replace(/\[PRESERVE:([^\]]+)\]/g, '$1');
	
	// Ensure proper Persian punctuation
	finalContent = finalContent
		.replace(/,/g, '،')          // Persian comma
		.replace(/;/g, '؛')          // Persian semicolon
		.replace(/\?/g, '؟');        // Persian question mark
	
	return finalContent;
}

/**
 * Validate HTML content for Telegram compatibility
 */
export function validateTelegramHtml(html: string): { isValid: boolean; errors: string[] } {
	const errors: string[] = [];
	
	// Check for unsupported HTML tags
	const supportedTags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a'];
	const tagMatches = html.match(/<(\/?[\w]+)[^>]*>/g) || [];
	
	tagMatches.forEach(tag => {
		const tagName = tag.match(/<\/?(\w+)/)?.[1]?.toLowerCase();
		if (tagName && !supportedTags.includes(tagName)) {
			errors.push(`Unsupported HTML tag: ${tagName}`);
		}
	});
	
	// Check for unescaped special characters
	const textContent = html.replace(/<[^>]*>/g, '');
	if (textContent.match(/[<>&"']/g)) {
		errors.push('Found unescaped HTML characters in text content');
	}
	
	// Check length
	const length = calculateHtmlLength(html);
	if (length > LIMITS.MAX_MESSAGE) {
		errors.push(`Message too long: ${length} > ${LIMITS.MAX_MESSAGE} characters`);
	}
	
	return {
		isValid: errors.length === 0,
		errors
	};
}
