/**
 * Input sanitization utilities for AI responses and user input
 */

/**
 * Sanitize text to prevent HTML/script injection
 */
export function sanitizeText(text: string): string {
	if (!text || typeof text !== 'string') {
		return '';
	}
	
	// Remove any script tags
	let sanitized = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
	
	// Remove any on* event handlers
	sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
	
	// Remove javascript: protocol
	sanitized = sanitized.replace(/javascript:/gi, '');
	
	// Limit length to prevent DOS
	const maxLength = 10000;
	if (sanitized.length > maxLength) {
		sanitized = sanitized.substring(0, maxLength);
	}
	
	return sanitized.trim();
}

/**
 * Sanitize URL to ensure it's a valid HTTP/HTTPS URL
 */
export function sanitizeUrl(url: string): string | null {
	if (!url || typeof url !== 'string') {
		return null;
	}
	
	const trimmed = url.trim();
	
	// Check if it's a valid HTTP/HTTPS URL
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}
		return parsed.toString();
	} catch {
		return null;
	}
}

/**
 * Sanitize hashtag to ensure it's alphanumeric and underscores only
 */
export function sanitizeHashtag(hashtag: string): string {
	if (!hashtag || typeof hashtag !== 'string') {
		return '';
	}
	
	// Remove # if present
	let cleaned = hashtag.replace(/^#+/, '');
	
	// Keep only alphanumeric, underscores, and common international characters
	cleaned = cleaned.replace(/[^\w\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g, '_');
	
	// Limit length
	const maxLength = 50;
	if (cleaned.length > maxLength) {
		cleaned = cleaned.substring(0, maxLength);
	}
	
	return cleaned.trim();
}

/**
 * Sanitize array of strings
 */
export function sanitizeArray<T extends string>(
	arr: unknown, 
	sanitizer: (item: string) => string = sanitizeText,
	maxItems: number = 100
): T[] {
	if (!Array.isArray(arr)) {
		return [];
	}
	
	return arr
		.slice(0, maxItems)
		.filter(item => typeof item === 'string')
		.map(item => sanitizer(item))
		.filter(item => item.length > 0) as T[];
}

/**
 * Sanitize AI analysis result
 */
export interface SanitizedAnalysisResult {
	tldr: string;
	bullets: string[];
	business_implication: string;
	target_audience: string;
	description: string;
	hashtags: string[];
}

export function sanitizeAnalysisResult(result: any): SanitizedAnalysisResult {
	// Ensure result is an object
	if (!result || typeof result !== 'object') {
		throw new Error('Invalid analysis result: not an object');
	}
	
	return {
		tldr: sanitizeText(result.tldr || ''),
		bullets: sanitizeArray(result.bullets, sanitizeText, 10),
		business_implication: sanitizeText(result.business_implication || ''),
		target_audience: sanitizeText(result.target_audience || ''),
		description: sanitizeText(result.description || ''),
		hashtags: sanitizeArray(result.hashtags, sanitizeHashtag, 20)
	};
}

/**
 * Validate and sanitize JSON response from AI
 */
export function sanitizeAIJsonResponse(jsonText: string): any {
	if (!jsonText || typeof jsonText !== 'string') {
		throw new Error('Invalid JSON response: empty or not a string');
	}
	
	// Limit JSON size to prevent DOS
	const maxJsonSize = 50000; // 50KB
	if (jsonText.length > maxJsonSize) {
		throw new Error(`JSON response too large: ${jsonText.length} bytes (max: ${maxJsonSize})`);
	}
	
	try {
		const parsed = JSON.parse(jsonText);
		
		// Ensure it's an object
		if (!parsed || typeof parsed !== 'object') {
			throw new Error('Invalid JSON: not an object');
		}
		
		return parsed;
	} catch (err) {
		throw new Error(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Clean and validate AI provider response content
 */
export function cleanAIResponse(content: string): string {
	if (!content || typeof content !== 'string') {
		throw new Error('Invalid AI response: empty or not a string');
	}
	
	// Remove markdown code blocks if present
	let cleaned = content.trim();
	cleaned = cleaned.replace(/^```(?:json)?\n?/i, '');
	cleaned = cleaned.replace(/\n?```$/i, '');
	cleaned = cleaned.trim();
	
	// Remove any leading/trailing whitespace
	cleaned = cleaned.trim();
	
	if (!cleaned) {
		throw new Error('AI response is empty after cleaning');
	}
	
	return cleaned;
}
