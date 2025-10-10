import Parser from 'rss-parser';
import axios from 'axios';
import { Article } from '../types';
import { logger } from '../logger';
import { filterByTimeRange } from '../utils/time';

const rssParser = new Parser();

// Circuit Breaker Pattern for URL Failure Tracking
interface UrlFailureCache {
	url: string;
	failureCount: number;
	lastFailure: number;
	blockedUntil: number;
	errorType: 'timeout' | 'forbidden' | 'other';
}

const urlFailureCache = new Map<string, UrlFailureCache>();

/**
 * Check if URL should be skipped due to circuit breaker
 */
function shouldSkipUrl(url: string): boolean {
	const cached = urlFailureCache.get(url);
	if (!cached) return false;
	
	const now = Date.now();
	
	// If URL is temporarily blocked, skip it
	if (now < cached.blockedUntil) {
		logger.debug({ 
			url: url.substring(0, 100),
			blockedFor: Math.ceil((cached.blockedUntil - now) / 1000) + 's',
			errorType: cached.errorType
		}, 'Skipping URL due to circuit breaker');
		return true;
	}
	
	// If block expired, reset
	if (cached.failureCount >= 3) {
		urlFailureCache.delete(url);
		logger.debug({ url: url.substring(0, 100) }, 'Circuit breaker reset for URL');
	}
	
	return false;
}

/**
 * Record URL failure for circuit breaker
 */
function recordUrlFailure(url: string, errorType: 'timeout' | 'forbidden' | 'other'): void {
	const cached = urlFailureCache.get(url) || {
		url,
		failureCount: 0,
		lastFailure: 0,
		blockedUntil: 0,
		errorType: 'other'
	};
	
	cached.failureCount++;
	cached.lastFailure = Date.now();
	cached.errorType = errorType;
	
	// Block duration increases with failure count and error type
	const blockDurations = {
		'forbidden': 60 * 60 * 1000,  // 1 hour for 403/401 errors
		'timeout': 10 * 60 * 1000,     // 10 minutes for timeouts
		'other': 5 * 60 * 1000          // 5 minutes for other errors
	};
	
	cached.blockedUntil = Date.now() + blockDurations[errorType];
	
	urlFailureCache.set(url, cached);
	
	logger.debug({ 
		url: url.substring(0, 100),
		failureCount: cached.failureCount,
		errorType,
		blockedUntil: new Date(cached.blockedUntil).toISOString()
	}, 'URL added to failure cache (circuit breaker)');
}

/**
 * Record URL success - reset failure count
 */
function recordUrlSuccess(url: string): void {
	const cached = urlFailureCache.get(url);
	if (cached) {
		urlFailureCache.delete(url);
		logger.debug({ url: url.substring(0, 100) }, 'URL success - removed from failure cache');
	}
}

// Rate limiting tracker to prevent overwhelming servers
const rateLimitTracker = {
	reddit: {
		lastRequest: 0,
		minInterval: 1500, // Minimum 1.5s between Reddit requests
		requestCount: 0,
		errors: 0
	},
	other: {
		lastRequest: 0,
		minInterval: 500, // Minimum 0.5s between other requests
		requestCount: 0,
		errors: 0
	}
};

// Helper to respect rate limits before making requests
async function respectRateLimit(isReddit: boolean): Promise<void> {
	const tracker = isReddit ? rateLimitTracker.reddit : rateLimitTracker.other;
	const now = Date.now();
	const timeSinceLastRequest = now - tracker.lastRequest;
	
	if (timeSinceLastRequest < tracker.minInterval) {
		const waitTime = tracker.minInterval - timeSinceLastRequest;
		logger.debug({ waitTime, isReddit, requestCount: tracker.requestCount }, 'Rate limiting: waiting before request');
		await delay(waitTime);
	}
	
	tracker.lastRequest = Date.now();
	tracker.requestCount++;
}

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractImageUrl(item: any): string | undefined {
	// Try different common image fields in RSS feeds
	const imageFields = [
		item.enclosure?.url, // Common for media enclosures
		item['media:content']?.['@_url'], // Media RSS
		item['media:thumbnail']?.['@_url'], // Media RSS thumbnail
		item.image?.url, // Some feeds have image.url
		item.image, // Some feeds have image as string
	];
	
	// Also try to extract from content/description HTML
	const contentFields = [item.content, item.contentSnippet, item.description];
	for (const content of contentFields) {
		if (typeof content === 'string') {
			// Look for img tags
			const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
			if (imgMatch && imgMatch[1]) {
				imageFields.push(imgMatch[1]);
			}
		}
	}
	
	// Find the first valid image URL
	for (const field of imageFields) {
		if (typeof field === 'string' && field.trim()) {
			const url = field.trim();
			// Basic validation - should be a URL
			if (url.startsWith('http://') || url.startsWith('https://')) {
				// Decode HTML entities in the URL
				const cleanUrl = url
					.replace(/&#038;/g, '&')
					.replace(/&amp;/g, '&')
					.replace(/&lt;/g, '<')
					.replace(/&gt;/g, '>')
					.replace(/&quot;/g, '"')
					.replace(/&#8217;/g, "'")
					.replace(/&#8216;/g, "'");
				
				logger.debug({ 
					title: item.title?.substring(0, 50) + '...',
					originalUrl: url.substring(0, 100) + '...',
					cleanUrl: cleanUrl.substring(0, 100) + '...',
					source: 'RSS extraction'
				}, 'Found and cleaned image URL in RSS feed');
				return cleanUrl;
			}
		}
	}
	
	logger.debug({ 
		title: item.title?.substring(0, 50) + '...',
		availableFields: Object.keys(item).filter(key => 
			key.includes('image') || key.includes('media') || key.includes('enclosure')
		)
	}, 'No valid image URL found in RSS item');
	
	return undefined;
}

// Extract Reddit post body (selftext) from content
function extractRedditDescription(item: any): string | undefined {
	const content = item.content || item.description || '';
	if (typeof content !== 'string' || !content.trim()) {
		return undefined;
	}
	
	// Reddit RSS includes HTML content - extract text
	// Remove HTML tags
	let text = content
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
	
	// If text is too short or looks like it's just the title, return undefined
	if (text.length < 50) {
		return undefined;
	}
	
	return text;
}

// Extract external link from Reddit post content
function extractExternalLink(item: any): string | undefined {
	// Check if the main link is not to reddit.com
	const mainLink = item.link || '';
	if (mainLink && !mainLink.includes('reddit.com') && !mainLink.includes('redd.it')) {
		logger.debug({ mainLink: mainLink.substring(0, 100) }, 'Found external link in main link field');
		return mainLink;
	}
	
	// Look for links in the content
	const content = item.content || item.description || '';
	if (typeof content === 'string') {
		// Look for all href links
		const hrefMatches = content.matchAll(/href=["']([^"']+)["']/gi);
		for (const match of hrefMatches) {
			const url = match[1];
			if (url && 
				!url.includes('reddit.com') && 
				!url.includes('redd.it') &&
				!url.startsWith('/r/') &&
				!url.startsWith('#') &&
				(url.startsWith('http://') || url.startsWith('https://'))) {
				logger.debug({ url: url.substring(0, 100) }, 'Found external link in content');
				return url;
			}
		}
		
		// Also try to find plain URLs in text
		const urlMatch = content.match(/https?:\/\/(?!(?:www\.)?reddit\.com|redd\.it)[^\s<>"']+/i);
		if (urlMatch) {
			logger.debug({ url: urlMatch[0].substring(0, 100) }, 'Found external URL in plain text');
			return urlMatch[0];
		}
	}
	
	return undefined;
}

// Fetch and summarize external linked content with circuit breaker and timeout protection
async function fetchLinkedContent(url: string): Promise<string | undefined> {
	try {
		// Check circuit breaker first
		if (shouldSkipUrl(url)) {
			return undefined;
		}
		
		logger.debug({ url: url.substring(0, 100) }, 'Fetching external linked content');
		
		// Skip non-http URLs (mailto, javascript, etc)
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			logger.debug({ url }, 'Skipping non-http URL');
			return undefined;
		}
		
		// Skip known media-only URLs (images, videos, etc)
		const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi', '.pdf', '.zip'];
		if (mediaExtensions.some(ext => url.toLowerCase().endsWith(ext))) {
			logger.debug({ url }, 'Skipping media file URL');
			return undefined;
		}
		
		// Add timeout protection using Promise.race
		const timeoutPromise = new Promise<never>((_, reject) => 
			setTimeout(() => reject(new Error('External content fetch timeout')), 8000) // 8 second timeout
		);
		
		const fetchPromise = axios.get(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9',
				'Accept-Encoding': 'gzip, deflate, br',
			},
			timeout: 7000, // 7 second axios timeout (shorter than Promise.race timeout)
			maxRedirects: 3, // Reduced redirects for faster responses
			validateStatus: (status) => status >= 200 && status < 400, // Accept 2xx and 3xx
		});
		
		const response = await Promise.race([fetchPromise, timeoutPromise]);
		
		// Check if response is HTML
		const contentType = response.headers['content-type'] || '';
		if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
			logger.debug({ url, contentType }, 'Skipping non-HTML content');
			return undefined;
		}
		
		const html = response.data;
		
		// Try to extract meaningful content (prioritize main content areas)
		// Look for common content containers
		let mainContent = '';
		
		// Try to extract from article, main, or common content divs
		const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
		const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
		const contentMatch = html.match(/<div[^>]*(?:class|id)=["'][^"']*(?:content|article|post|entry)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
		
		if (articleMatch) {
			mainContent = articleMatch[1]!;
			logger.debug({ url }, 'Extracted content from <article> tag');
		} else if (mainMatch) {
			mainContent = mainMatch[1]!;
			logger.debug({ url }, 'Extracted content from <main> tag');
		} else if (contentMatch) {
			mainContent = contentMatch[1]!;
			logger.debug({ url }, 'Extracted content from content div');
		} else {
			mainContent = html;
			logger.debug({ url }, 'Using full HTML (no specific content container found)');
		}
		
		// Extract text content from HTML
		// Remove script, style, nav, footer, header, and comment tags
		let text = mainContent
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
			.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
			.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
			.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<[^>]*>/g, ' ')
			// Decode common HTML entities
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#8217;/g, "'")
			.replace(/&#8216;/g, "'")
			.replace(/&#8220;/g, '"')
			.replace(/&#8221;/g, '"')
			.replace(/&#8211;/g, '-')
			.replace(/&#8212;/g, '—')
			.replace(/&mdash;/g, '—')
			.replace(/&ndash;/g, '–')
			.replace(/&rsquo;/g, "'")
			.replace(/&lsquo;/g, "'")
			.replace(/&rdquo;/g, '"')
			.replace(/&ldquo;/g, '"')
			// Clean up whitespace
			.replace(/\s+/g, ' ')
			.trim();
		
		// Remove common boilerplate text
		text = text
			.replace(/cookie policy/gi, '')
			.replace(/privacy policy/gi, '')
			.replace(/terms of service/gi, '')
			.replace(/subscribe to our newsletter/gi, '')
			.replace(/sign up for/gi, '');
		
		// If text is too short, it's probably not useful
		if (text.length < 100) {
			logger.debug({ url, textLength: text.length }, 'Extracted content too short, skipping');
			return undefined;
		}
		
		// Limit to first 1500 characters for better context (increased from 1000)
		if (text.length > 1500) {
			// Try to cut at a sentence boundary
			const cutPoint = text.lastIndexOf('. ', 1500);
			if (cutPoint > 1000) {
				text = text.substring(0, cutPoint + 1);
			} else {
				text = text.substring(0, 1500) + '...';
			}
		}
		
		logger.info({ 
			url: url.substring(0, 100), 
			textLength: text.length,
			preview: text.substring(0, 100) + '...'
		}, 'Successfully fetched and extracted external content');
		
		// Record success in circuit breaker
		recordUrlSuccess(url);
		
		return text;
		
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		
		// Determine error type for circuit breaker
		let errorType: 'timeout' | 'forbidden' | 'other' = 'other';
		if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('ECONNABORTED')) {
			errorType = 'timeout';
		} else if (errorMsg.includes('403') || errorMsg.includes('401') || errorMsg.includes('Forbidden') || errorMsg.includes('Unauthorized')) {
			errorType = 'forbidden';
		}
		
		// Record failure in circuit breaker
		recordUrlFailure(url, errorType);
		
		// Don't log 403 errors as warnings - they're expected
		if (errorType === 'forbidden') {
			logger.debug({ url: url.substring(0, 100) }, 'External content blocked (403/401)');
		} else {
			logger.warn({ 
				url: url.substring(0, 100), 
				error: errorMsg,
				errorType
			}, 'Failed to fetch external linked content');
		}
		
		return undefined;
	}
}

export const DEFAULT_FEEDS: string[] = [
	'https://www.theverge.com/rss/index.xml', // Main feed since AI-specific is 404
	'https://huggingface.co/blog/feed.xml', // Hugging Face AI blog
	'https://blog.google/technology/ai/rss/', // Google AI blog
	'https://www.reddit.com/r/PromptEngineering/.rss', // Reddit r/PromptEngineering
	'https://www.reddit.com/r/forhire/.rss', // Reddit r/forhire
	'https://www.reddit.com/r/beermoney/.rss', // Reddit r/beermoney
	'https://www.reddit.com/r/WorkOnline/.rss', // Reddit r/WorkOnline
	'https://www.reddit.com/r/devopsjobs/.rss', // Reddit r/devopsjobs
	'https://www.reddit.com/r/remotejs/.rss', // Reddit r/remotejs
	'https://www.reddit.com/r/hiring/.rss', // Reddit r/hiring
	'https://www.reddit.com/r/passive_income/.rss', // Reddit r/passive_income
	'https://www.reddit.com/r/juststart/.rss', // Reddit r/juststart
	'https://www.reddit.com/r/indiebiz/.rss', // Reddit r/indiebiz
	'https://www.reddit.com/r/Entrepreneur/.rss', // Reddit r/Entrepreneur
	'https://www.reddit.com/r/startups/.rss', // Reddit r/startups
	'https://www.reddit.com/r/SideProject/.rss', // Reddit r/SideProject
	'https://www.reddit.com/r/SaaS/.rss', // Reddit r/SaaS
	'https://www.reddit.com/r/microsaas/.rss', // Reddit r/microsaas
	'https://www.reddit.com/r/nocode/.rss', // Reddit r/nocode
	'https://www.reddit.com/r/BlockchainStartups/.rss', // Reddit r/BlockchainStartups
	'https://www.reddit.com/r/automation/.rss', // Reddit r/automation
	'https://www.reddit.com/r/IMadeThis/.rss', // Reddit r/IMadeThis
	'https://www.reddit.com/r/indiehackers/.rss', // Reddit r/indiehackers
	// Product Hunt & Future Tools require API integration (no public RSS)
];

function toIsoString(dateLike: string | Date | undefined): string {
	try {
		if (!dateLike) return new Date().toISOString();
		const d = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
		return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
	} catch {
		return new Date().toISOString();
	}
}

function getErrorMessage(err: any, url: string): string {
	if (axios.isAxiosError(err) && err.response) {
		const status = err.response.status;
		const domain = new URL(url).hostname;
		switch (status) {
			case 429: return `Rate limited by ${domain} - too many requests`;
			case 403: return `Access forbidden by ${domain} - may need authentication`;
			case 404: return `RSS feed not found at ${domain} - URL may be outdated`;
			case 500: return `Server error at ${domain} - temporary issue`;
			default: return `HTTP ${status} error from ${domain}`;
		}
	}
	return `Network error from ${new URL(url).hostname}: ${err.message || 'Unknown error'}`;
}

// Helper function to detect if URL is a Reddit feed
function isRedditFeed(url: string): boolean {
	return url.includes('reddit.com');
}

// Helper function to get Reddit /new/ (latest) URL
function getRedditNewUrl(baseUrl: string): string {
	// Convert https://www.reddit.com/r/subreddit/.rss to https://www.reddit.com/r/subreddit/new/.rss
	return baseUrl.replace(/\.rss$/, '/new/.rss');
}

// Remove duplicate articles by link
function deduplicateArticles(articles: Article[]): Article[] {
	const seen = new Set<string>();
	return articles.filter(article => {
		if (seen.has(article.link)) {
			return false;
		}
		seen.add(article.link);
		return true;
	});
}

// Internal function to fetch a single RSS URL
async function fetchSingleRssFeed(url: string): Promise<Article[]> {
	const maxRetries = 3; // Increased from 2 to 3 for better reliability
	let retryDelay = 3000; // Increased from 2s to 3s for safer initial delay
	const isReddit = isRedditFeed(url);
	
	// Respect rate limits before making request
	await respectRateLimit(isReddit);
	
	// For Reddit, skip rss-parser and go straight to axios with better headers
	if (!isRedditFeed(url)) {
		try {
			const feed = await rssParser.parseURL(url);
			const items = (feed.items || []).map((item) => {
				const imageUrl = extractImageUrl(item);
				return {
					title: item.title ?? 'Untitled',
					link: item.link ?? '',
					contentSnippet: (item.contentSnippet || item.content || '').toString().trim(),
					pubDate: toIsoString(item.isoDate || (item.pubDate as string | undefined)),
					...(imageUrl && { imageUrl }),
				};
			});
			logger.debug({ url, count: items.length }, 'fetched feed');
			return items;
		} catch (err) {
			logger.warn({ url, error: getErrorMessage(err, url) }, 'parseURL failed, retrying with axios');
		}
	} else {
		// For Reddit feeds, we'll process them with external content fetching
		logger.debug({ url }, 'Processing Reddit feed with enhanced extraction');
	}

	// Fallback to axios with retries for 429 errors
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			// Use more realistic headers for Reddit to avoid 403 blocks
			const isReddit = isRedditFeed(url);
			const headers = isReddit ? {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9',
				'Accept-Encoding': 'gzip, deflate, br',
				'DNT': '1',
				'Connection': 'keep-alive',
				'Upgrade-Insecure-Requests': '1',
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'none',
				'Cache-Control': 'max-age=0',
			} : {
				'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/2.0)',
				'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
			};
			
			const res = await axios.get(url, {
				headers,
				timeout: 15000,
				maxRedirects: 5,
			});
			
			const feed = await rssParser.parseString(res.data);
			
			// Process items with Reddit-specific extraction (isReddit already declared above)
			const items: Article[] = [];
			for (const item of feed.items || []) {
				const imageUrl = extractImageUrl(item);
				const article: Article = {
					title: item.title ?? 'Untitled',
					link: item.link ?? '',
					contentSnippet: (item.contentSnippet || item.content || '').toString().trim(),
					pubDate: toIsoString(item.isoDate || (item.pubDate as string | undefined)),
					...(imageUrl && { imageUrl }),
				};
				
				// For Reddit posts, extract additional data
				if (isReddit) {
					// Extract post body/selftext
					const description = extractRedditDescription(item);
					if (description) {
						article.description = description;
					}
					
					// Extract and fetch external linked content (non-blocking)
					const externalLink = extractExternalLink(item);
					if (externalLink) {
						// Store the external URL itself
						article.externalLink = externalLink;
						
						// Non-blocking fetch: Try to get external content but don't wait for it
						// This prevents timeouts and blocks while still attempting to enrich content
						fetchLinkedContent(externalLink)
							.then(linkedContent => {
								if (linkedContent) {
									article.linkedContent = linkedContent;
									logger.debug({ 
										title: article.title.substring(0, 50),
										externalLink: externalLink.substring(0, 100),
										contentLength: linkedContent.length 
									}, 'External content fetched successfully (non-blocking)');
								}
							})
							.catch(err => {
								logger.debug({ 
									url: externalLink.substring(0, 100),
									error: err instanceof Error ? err.message : String(err)
								}, 'External content fetch failed (non-blocking) - proceeding without it');
							});
						
						// Continue immediately without waiting for external content
					}
				}
				
				items.push(article);
			}
			
			logger.debug({ url, count: items.length, attempt, isReddit }, 'fetched feed (axios fallback)');
			return items;
			
		} catch (err2) {
			const errorMsg = getErrorMessage(err2, url);
			
			// Handle 429 rate limit or 403 forbidden with retry
			if (axios.isAxiosError(err2) && err2.response && 
				(err2.response.status === 429 || err2.response.status === 403) && 
				attempt < maxRetries) {
				const retryAfter = err2.response.headers['retry-after'];
				const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : retryDelay;
				
				// Track error in rate limiter
				const tracker = isReddit ? rateLimitTracker.reddit : rateLimitTracker.other;
				tracker.errors++;
				
				logger.warn({ 
					url, 
					attempt, 
					status: err2.response.status,
					waitTime: waitTime / 1000,
					totalErrors: tracker.errors
				}, `Blocked (${err2.response.status}), retrying in ${waitTime / 1000}s`);
				await delay(waitTime);
				retryDelay *= 2; // Exponential backoff
				continue;
			}
			
			// Log final error and return empty array
			if (attempt === maxRetries) {
				logger.error({ url, error: errorMsg, attempts: attempt + 1 }, 'failed to fetch feed after retries');
				return [];
			}
		}
	}
	
	return [];
}

// Main function to fetch RSS feed - handles Reddit specially to get both best and latest posts
export async function fetchRssFeed(url: string): Promise<Article[]> {
	// Special handling for Reddit feeds - fetch both best (hot) and latest (new) SEQUENTIALLY
	if (isRedditFeed(url)) {
		logger.info({ url }, 'Detected Reddit feed, fetching both best and latest posts sequentially');
		
		try {
			// Fetch best/hot posts (default feed) FIRST
			const bestPosts = await fetchSingleRssFeed(url);
			
			// Add delay between Reddit requests to same subreddit
			logger.debug({ url, delay: 1500 }, 'Waiting before fetching latest posts from same subreddit');
			await delay(1500); // 1.5 second delay between requests to same subreddit
			
			// Fetch latest/new posts SECOND
			const newUrl = getRedditNewUrl(url);
			const latestPosts = await fetchSingleRssFeed(newUrl);
			
			// Combine and deduplicate
			const combined = [...bestPosts, ...latestPosts];
			const deduplicated = deduplicateArticles(combined);
			
			// Sort by date (newest first)
			deduplicated.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			logger.info({ 
				url, 
				bestCount: bestPosts.length, 
				latestCount: latestPosts.length,
				totalUnique: deduplicated.length 
			}, 'Fetched and combined Reddit best + latest posts');
			
			return deduplicated;
		} catch (err) {
			logger.error({ url, err }, 'Failed to fetch Reddit feed with best+latest, falling back to single fetch');
			return fetchSingleRssFeed(url);
		}
	}
	
	// For non-Reddit feeds, use standard fetch
	return fetchSingleRssFeed(url);
}

export async function fetchAllArticles(feedUrls: string[] = DEFAULT_FEEDS, options?: { maxAgeHours?: number; excludeReddit?: boolean }): Promise<Article[]> {
	let feeds = feedUrls;
	
	// Exclude Reddit feeds if requested
	if (options?.excludeReddit) {
		feeds = feeds.filter(url => !url.includes('reddit.com'));
		logger.info({ 
			totalFeeds: feedUrls.length,
			nonRedditFeeds: feeds.length 
		}, 'Excluding Reddit feeds from auto-posting');
	}
	
	const articles: Article[] = [];
	const errors: Array<{ url: string; error: string }> = [];
	
	logger.info({ 
		totalFeeds: feeds.length,
		estimatedTime: `${Math.ceil(feeds.length * 2.5 / 60)} minutes (with rate limiting)`
	}, 'Starting to fetch all articles');
	
	// Fetch feeds sequentially with delays to avoid rate limits
	for (let i = 0; i < feeds.length; i++) {
		const url = feeds[i]!;
		
		try {
			const feedArticles = await fetchRssFeed(url);
			articles.push(...feedArticles);
			
			logger.info({ 
				progress: `${i + 1}/${feeds.length}`,
				url: url.substring(0, 60) + (url.length > 60 ? '...' : ''),
				articlesFromThisFeed: feedArticles.length,
				totalArticlesSoFar: articles.length
			}, 'Feed fetched successfully');
			
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			errors.push({ url, error: errorMsg });
			logger.error({ 
				url: url.substring(0, 60) + (url.length > 60 ? '...' : ''), 
				error: errorMsg, 
				progress: `${i + 1}/${feeds.length}` 
			}, 'Failed to fetch feed, continuing with next');
			// Continue with next feed instead of stopping
		}
		
		// Add delay between feeds (except for the last one)
		if (i < feeds.length - 1) {
			// Longer delay for Reddit feeds to avoid rate limiting
			const isReddit = isRedditFeed(url);
			const delayMs = isReddit ? 2000 : 1000; // 2s for Reddit, 1s for others
			
			logger.debug({ 
				delayMs, 
				nextFeed: feeds[i + 1]?.substring(0, 60) 
			}, 'Waiting before next feed');
			await delay(delayMs);
		}
	}
	
	// Log summary
	if (errors.length > 0) {
		logger.warn({ 
			totalFeeds: feeds.length,
			successfulFeeds: feeds.length - errors.length,
			failedFeeds: errors.length,
			errors: errors.slice(0, 5) // Log first 5 errors
		}, 'Some feeds failed to fetch');
	}
	
	// Optional max age filter first
	const filtered = typeof options?.maxAgeHours === 'number' ? filterByTimeRange(articles, options.maxAgeHours) : articles;
	// Sort newest first via ISO string compare
	filtered.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
	
	logger.info({ 
		totalArticles: filtered.length, 
		maxAgeHours: options?.maxAgeHours, 
		feedCount: feedUrls.length,
		successRate: `${Math.round((feedUrls.length - errors.length) / feedUrls.length * 100)}%`,
		redditRequests: rateLimitTracker.reddit.requestCount,
		redditErrors: rateLimitTracker.reddit.errors,
		otherRequests: rateLimitTracker.other.requestCount,
		otherErrors: rateLimitTracker.other.errors
	}, 'Article aggregation complete');
	
	return filtered;
}

export async function getRecentArticles(hours: number, feedUrls: string[] = DEFAULT_FEEDS): Promise<Article[]> {
	return fetchAllArticles(feedUrls, { maxAgeHours: hours });
}

/**
 * Validate if a Reddit link still exists (not deleted/removed)
 * @param url - The URL to validate
 * @returns true if link is valid or not Reddit, false if deleted/removed
 */
export async function validateRedditLink(url: string): Promise<boolean> {
	if (!url.includes('reddit.com')) {
		return true; // Not Reddit, assume valid
	}
	
	try {
		logger.debug({ url: url.substring(0, 80) }, 'Validating Reddit link');
		
		const response = await axios.head(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			},
			timeout: 5000,
			maxRedirects: 5,
			validateStatus: (status) => status < 500, // Accept anything except server errors
		});
		
		// Check if post was deleted or removed
		// Reddit returns 404 or 403 for deleted/removed posts
		if (response.status === 404 || response.status === 403) {
			logger.warn({ 
				url: url.substring(0, 80), 
				status: response.status 
			}, 'Reddit post appears to be deleted or removed');
			return false;
		}
		
		logger.debug({ 
			url: url.substring(0, 80), 
			status: response.status 
		}, 'Reddit link validated successfully');
		return true;
		
	} catch (err) {
		// If we can't validate, assume it's valid (don't block posting unnecessarily)
		const errorMsg = err instanceof Error ? err.message : String(err);
		logger.warn({ 
			url: url.substring(0, 80), 
			error: errorMsg 
		}, 'Could not validate Reddit link, assuming valid');
		return true;
	}
}

/**
 * Fetch a single Reddit feed (for Reddit browser)
 * @param url - Reddit RSS URL
 * @param subredditName - Name of the subreddit (for logging)
 * @param maxPosts - Maximum number of posts to return (default: 3)
 */
export async function fetchSingleRedditFeed(
	url: string, 
	subredditName: string,
	maxPosts: number = 3
): Promise<Article[]> {
	logger.info({ subreddit: subredditName, url: url.substring(0, 80) }, 'Fetching single Reddit feed');

	try {
		// Respect rate limits
		await respectRateLimit(true);

		// Fetch the feed
		const articles = await fetchSingleRssFeed(url);

		// Sort by date (newest first)
		articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));

		// Limit to maxPosts
		const limited = articles.slice(0, maxPosts);

		logger.info({ 
			subreddit: subredditName, 
			fetched: articles.length,
			returned: limited.length 
		}, 'Successfully fetched single Reddit feed');

		return limited;

	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		logger.error({ 
			err: errorMsg,
			subreddit: subredditName,
			url: url.substring(0, 80)
		}, 'Failed to fetch single Reddit feed');
		return [];
	}
}

