/**
 * Image Service - Hybrid approach for getting/creating images
 * 1. Use existing imageUrl if available
 * 2. Fetch Open Graph image from external link
 * 3. Generate template image as fallback
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { Article } from '../types';
import {
	generateTemplateImage,
	extractSubreddit,
	determineCategory
} from '../utils/image-generator';
import { getTimeAgo } from '../utils/time';
import { logger } from '../logger';

/**
 * Cache directory for generated images
 */
const IMAGE_CACHE_DIR = join(process.cwd(), 'data', 'images');

/**
 * Ensure image cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
	if (!existsSync(IMAGE_CACHE_DIR)) {
		await mkdir(IMAGE_CACHE_DIR, { recursive: true });
	}
}

/**
 * Generate a safe filename from URL or title
 */
function generateImageFilename(article: Article): string {
	// Use article link hash for consistent naming
	const hash = Buffer.from(article.link).toString('base64url').substring(0, 20);
	return `${hash}.png`;
}

/**
 * Save image buffer to cache and return file path
 */
async function saveImageToCache(buffer: Buffer, filename: string): Promise<string> {
	await ensureCacheDir();
	const filepath = join(IMAGE_CACHE_DIR, filename);
	await writeFile(filepath, buffer);
	
	logger.info({ filepath, size: buffer.length }, 'Saved generated image to cache');
	return filepath;
}

/**
 * Fetch Open Graph image from a URL
 */
export async function fetchOpenGraphImage(url: string): Promise<string | undefined> {
	try {
		logger.info({ url: url.substring(0, 100) }, 'Attempting to fetch Open Graph image');
		
		const response = await axios.get(url, {
			timeout: 8000,
			maxRedirects: 3,
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml',
				'Accept-Language': 'en-US,en;q=0.9'
			}
		});
		
		// Parse HTML with cheerio
		const $ = cheerio.load(response.data);
		
		// Try multiple meta tags in order of preference
		const ogImageSelectors = [
			'meta[property="og:image"]',
			'meta[property="og:image:secure_url"]',
			'meta[name="twitter:image"]',
			'meta[name="twitter:image:src"]',
			'meta[itemprop="image"]'
		];
		
		for (const selector of ogImageSelectors) {
			const content = $(selector).attr('content');
			if (content && (content.startsWith('http://') || content.startsWith('https://'))) {
				logger.info({
					url: url.substring(0, 100),
					imageUrl: content.substring(0, 100),
					method: selector
				}, 'Found Open Graph image');
				
				return content;
			}
		}
		
		// If no OG image, try to find first image in content
		const firstImg = $('article img, main img, .content img').first().attr('src');
		if (firstImg && (firstImg.startsWith('http://') || firstImg.startsWith('https://'))) {
			logger.info({
				url: url.substring(0, 100),
				imageUrl: firstImg.substring(0, 100),
				method: 'first content image'
			}, 'Found content image as fallback');
			
			return firstImg;
		}
		
		logger.debug({ url: url.substring(0, 100) }, 'No Open Graph image found');
		return undefined;
		
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		
		// Don't log as error for expected failures (timeouts, 404s, etc.)
		if (error.includes('timeout') || error.includes('404') || error.includes('ENOTFOUND')) {
			logger.debug({
				url: url.substring(0, 100),
				error
			}, 'Could not fetch Open Graph image (expected failure)');
		} else {
			logger.warn({
				url: url.substring(0, 100),
				error
			}, 'Failed to fetch Open Graph image');
		}
		
		return undefined;
	}
}

/**
 * Get or create image for an article (Hybrid approach)
 * Priority:
 * 1. Existing article.imageUrl (if valid)
 * 2. Open Graph image from article.externalLink
 * 3. Generated template image (always works)
 */
export async function getOrCreateImage(article: Article): Promise<{
	imageUrl?: string;
	imageBuffer?: Buffer;
	isGenerated: boolean;
}> {
	try {
		// === STEP 1: Use existing imageUrl if available ===
		if (article.imageUrl) {
			logger.info({
				title: article.title.substring(0, 50),
				imageUrl: article.imageUrl.substring(0, 100)
			}, 'Using existing article image');
			
			return {
				imageUrl: article.imageUrl,
				isGenerated: false
			};
		}
		
		// === STEP 2: Try to fetch Open Graph image from external link ===
		if (article.externalLink && article.externalLink !== article.link) {
			logger.info({
				title: article.title.substring(0, 50),
				externalLink: article.externalLink.substring(0, 100)
			}, 'Attempting to fetch Open Graph image');
			
			const ogImage = await fetchOpenGraphImage(article.externalLink);

			if (ogImage) {
				logger.info({
					title: article.title.substring(0, 50),
					ogImage: ogImage.substring(0, 100)
				}, 'Using Open Graph image from external link');

				return {
					imageUrl: ogImage,
					isGenerated: false
				};
			}
		}
		
		// === STEP 3: Generate template image (fallback - always works) ===
		logger.info({
			title: article.title.substring(0, 50),
			reason: article.externalLink ? 'No OG image found' : 'No external link'
		}, 'Generating template image');
		
		const subreddit = extractSubreddit(article.link);
		const category = determineCategory(article);
		const timeAgo = getTimeAgo(article.pubDate);
		
		const imageBuffer = await generateTemplateImage({
			subreddit,
			category,
			title: article.title,
			timeAgo
		});
		
		// Save to cache for potential reuse
		const filename = generateImageFilename(article);
		const filepath = await saveImageToCache(imageBuffer, filename);
		
		logger.info({
			title: article.title.substring(0, 50),
			filepath,
			subreddit,
			category
		}, 'Template image generated and cached');
		
		return {
			imageBuffer,
			isGenerated: true
		};
		
	} catch (err) {
		logger.error({
			err: err instanceof Error ? err.message : String(err),
			title: article.title.substring(0, 50)
		}, 'Failed to get or create image');
		
		// Return nothing - let the post service handle it
		return {
			isGenerated: false
		};
	}
}

/**
 * Get cached image path if it exists
 */
export function getCachedImagePath(article: Article): string | undefined {
	const filename = generateImageFilename(article);
	const filepath = join(IMAGE_CACHE_DIR, filename);
	
	if (existsSync(filepath)) {
		return filepath;
	}
	
	return undefined;
}

