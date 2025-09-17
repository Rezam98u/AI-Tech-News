import axios from 'axios';
import { logger } from '../logger';

interface ShortenedLink {
	originalUrl: string;
	shortUrl: string;
	domain: string;
}

// Cache to avoid re-shortening the same URLs
const linkCache = new Map<string, ShortenedLink>();

/**
 * Compress a URL using a URL shortening service
 * Falls back to original URL if shortening fails
 */
export async function compressLink(url: string): Promise<ShortenedLink> {
	// Check cache first
	if (linkCache.has(url)) {
		return linkCache.get(url)!;
	}

	try {
		// Use TinyURL API (free, no API key required)
		const response = await axios.post('https://tinyurl.com/api-create.php', null, {
			params: { url },
			timeout: 5000,
		});

		const shortUrl = response.data.trim();
		
		// Validate the response
		if (shortUrl && shortUrl.startsWith('http') && shortUrl !== url) {
			const result: ShortenedLink = {
				originalUrl: url,
				shortUrl,
				domain: extractDomain(url),
			};
			
			// Cache the result
			linkCache.set(url, result);
			return result;
		}
	} catch (err) {
		logger.warn({ err, url }, 'Failed to compress link, using original');
	}

	// Fallback to original URL
	const result: ShortenedLink = {
		originalUrl: url,
		shortUrl: url,
		domain: extractDomain(url),
	};
	
	linkCache.set(url, result);
	return result;
}

/**
 * Compress multiple URLs and return a formatted reference list
 */
export async function compressLinks(urls: string[]): Promise<{
	compressedUrls: string[];
	references: string[];
}> {
	const uniqueUrls = [...new Set(urls)]; // Remove duplicates
	const compressedResults = await Promise.all(
		uniqueUrls.map(url => compressLink(url))
	);

	const compressedUrls: string[] = [];
	const references: string[] = [];

	compressedResults.forEach((result, index) => {
		compressedUrls.push(result.shortUrl);
		
		// Only add to references if URL was actually shortened
		if (result.shortUrl !== result.originalUrl) {
			references.push(`${index + 1}. ${result.domain}: ${result.shortUrl}`);
		}
	});

	return { compressedUrls, references };
}

/**
 * Extract domain from URL for display purposes
 */
function extractDomain(url: string): string {
	try {
		const urlObj = new URL(url);
		return urlObj.hostname.replace(/^www\./, '');
	} catch {
		return 'unknown';
	}
}

/**
 * Format references for display at the end of posts
 */
export function formatReferences(references: string[]): string {
	if (references.length === 0) return '';
	
	return `\n\n📎 References:\n${references.join('\n')}`;
}
