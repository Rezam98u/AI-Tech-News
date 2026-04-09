/**
 * Post creation and formatting service
 */
import { Telegraf } from 'telegraf';
import { Article } from '../types';
import type { AnalysisResultWithFallback } from '../ai-analysis/index';
import { getPostReadyAnalysis } from '../ai-analysis/optimized';
import { getTimeAgo } from '../utils/time';
import { calculateHtmlLength, splitIntoThreads, buildHtmlPost, LIMITS } from '../utils/html-utils';
import { logger } from '../logger';

function buildPostHtml(article: Article, analysis: AnalysisResultWithFallback): string {
	const timeAgo = getTimeAgo(article.pubDate);
	const businessImpact = analysis.business_implication?.trim() || '';
	const includeBusiness = businessImpact.length > 20;

	return buildHtmlPost({
		tldr: analysis.tldr,
		bullets: analysis.bullets || [],
		businessImpact: includeBusiness ? businessImpact : '',
		description: analysis.description,
		hashtags: analysis.hashtags,
		timeAgo,
		link: article.link,
		...(article.externalLink && { externalLink: article.externalLink }),
		isPersian: false,
		maxLength: LIMITS.SINGLE_POST
	});
}

/**
 * Post service class for handling post creation and sending
 */
export class PostService {
	private bot: Telegraf;

	constructor(bot: Telegraf) {
		this.bot = bot;
	}


	/**
	 * Create an enhanced post with AI analysis and HTML formatting
	 * Returns null if analysis is fallback (to prevent posting)
	 */
	async createEnhancedPost(article: Article): Promise<string | null> {
		try {
			logger.info({ title: article.title }, 'Generating optimized AI analysis for post');
			const analysis = await getPostReadyAnalysis(article);

			if (analysis.isFallback) {
				logger.warn({ title: article.title }, 'Skipping post due to fallback analysis - AI analysis failed');
				return null;
			}

			logger.info({
				title: article.title,
				hasDescription: !!analysis.description,
				hashtagCount: analysis.hashtags.length
			}, 'Optimized AI analysis completed');

			const htmlPost = buildPostHtml(article, analysis);
			const postLength = calculateHtmlLength(htmlPost);

			logger.info({
				title: article.title,
				postLength,
				hasBusinessImpact: (analysis.business_implication?.trim() || '').length > 20
			}, 'HTML enhanced post created successfully');
			
			// Check if post needs to be split into threads
			if (postLength > LIMITS.SINGLE_POST) {
				logger.info({ 
					postLength, 
					limit: LIMITS.SINGLE_POST,
					willCreateThread: true 
				}, 'Post exceeds single post limit, client should consider threading');
			}
			
			return htmlPost;
			
		} catch (err) {
			logger.error({ 
				err: err instanceof Error ? err.message : String(err), 
				article: article.title
			}, 'Failed to create enhanced post - skipping due to error');
			
			// Don't create fallback post - return null to skip posting
			return null;
		}
	}

	/**
	 * Create threaded posts for long content
	 * Returns empty array if analysis is fallback (to prevent posting)
	 */
	async createThreadedPost(article: Article): Promise<string[]> {
		try {
			const fullPost = await this.createEnhancedPost(article);
			
			// If createEnhancedPost returned null (fallback analysis), return empty array
			if (!fullPost) {
				logger.warn({ title: article.title }, 'Skipping threaded post due to fallback analysis');
				return [];
			}
			
			const postLength = calculateHtmlLength(fullPost);
			
			// If post fits in single message, return as is
			if (postLength <= LIMITS.SINGLE_POST) {
				return [fullPost];
			}
			
			logger.info({ 
				postLength, 
				limit: LIMITS.SINGLE_POST,
				willSplit: true 
			}, 'Creating threaded post for long content');
			
			// Split into thread messages
			const { messages } = splitIntoThreads(fullPost, LIMITS.THREAD_POST);
			
			logger.info({ 
				originalLength: postLength,
				threadCount: messages.length,
				title: article.title 
			}, 'Created threaded post');
			
			return messages;
			
		} catch (err) {
			logger.error({ 
				err: err instanceof Error ? err.message : String(err), 
				article: article.title 
			}, 'Failed to create threaded post - skipping');
			
			// Don't create fallback - return empty array to skip posting
			return [];
		}
	}

	/**
	 * Send a post with optional image, handling Telegram's limitations and HTML formatting
	 * Supports both image URLs and Buffer objects for generated images
	 */
	async sendPostWithImage(chatId: string, message: string, imageUrl?: string | Buffer): Promise<void> {
		const messageLength = calculateHtmlLength(message);
		
		const isBuffer = Buffer.isBuffer(imageUrl);
		
		logger.info({ 
			hasImageUrl: !!imageUrl,
			isBuffer,
			imageUrl: isBuffer ? 'Buffer' : (typeof imageUrl === 'string' ? imageUrl.substring(0, 100) + '...' : undefined),
			messageLength,
			htmlLength: messageLength,
			chatId 
		}, 'Attempting to send HTML post with image');

		if (imageUrl) {
			try {
				// Validate image URL (skip for Buffer)
				if (!isBuffer && typeof imageUrl === 'string' && !imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
					logger.warn({ imageUrl }, 'Invalid image URL format, falling back to text');
					throw new Error('Invalid URL format');
				}

				// Check if message is too long for Telegram caption (1024 char limit)
				if (messageLength > LIMITS.CAPTION_WITH_PHOTO) {
					logger.info({ 
						messageLength,
						limit: LIMITS.CAPTION_WITH_PHOTO 
					}, 'Message too long for caption, splitting into image + text');
					
					// Send image with short caption, then send full text
					const shortCaption = '<b>📰 Latest AI Tech News</b>';
					
					const photoInput = isBuffer ? { source: imageUrl as Buffer } : imageUrl as string;
					await this.bot.telegram.sendPhoto(chatId, photoInput, {
						caption: shortCaption,
						parse_mode: 'HTML',
					});
					
					// Send full message as separate text
					await this.bot.telegram.sendMessage(chatId, message, { 
						link_preview_options: { is_disabled: true },
						parse_mode: 'HTML'
					});
					
					logger.info('Photo and text sent successfully (split method with HTML)');
					return;
				}

				// Try to send with image first (if message is short enough)
				logger.info({ 
					imageUrl: isBuffer ? 'Buffer image' : (typeof imageUrl === 'string' ? imageUrl.substring(0, 100) + '...' : 'unknown'),
					messageLength 
				}, 'Sending photo with HTML caption to Telegram');
				
				const photoOptions = {
					caption: message,
					parse_mode: 'HTML' as const,
				};

				// Handle Buffer vs URL
				if (isBuffer) {
					// Send Buffer directly
					await this.bot.telegram.sendPhoto(chatId, { source: imageUrl as Buffer }, photoOptions);
					logger.info('Photo sent successfully from Buffer with HTML');
				} else if (typeof imageUrl === 'string') {
					// Method 1: Direct URL
					try {
						await this.bot.telegram.sendPhoto(chatId, imageUrl, photoOptions);
						logger.info('Photo sent successfully via direct URL with HTML');
					} catch (directError) {
						logger.warn({ error: String(directError) }, 'Direct URL failed, trying with Input object');
						
						// Method 2: Using Input object (sometimes works better)
						await this.bot.telegram.sendPhoto(chatId, { url: imageUrl }, photoOptions);
						logger.info('Photo sent successfully via Input object with HTML');
					}
				}
			} catch (err) {
				// If image fails, fall back to text only
				const errorMsg = err instanceof Error ? err.message : String(err);
				const imageDesc = isBuffer ? 'Buffer image' : (typeof imageUrl === 'string' ? imageUrl.substring(0, 100) + '...' : 'unknown');
				logger.warn({ 
					error: errorMsg, 
					imageUrl: imageDesc
				}, 'Failed to send image, falling back to HTML text');
				
				await this.bot.telegram.sendMessage(chatId, message, { 
					link_preview_options: { is_disabled: true },
					parse_mode: 'HTML'
				});
			}
		} else {
			// No image, send text only
			logger.info('No image URL provided, sending HTML text only');
			await this.bot.telegram.sendMessage(chatId, message, { 
				link_preview_options: { is_disabled: true },
				parse_mode: 'HTML'
			});
		}
	}

	/**
	 * Send threaded posts as separate messages
	 * Supports both image URLs and Buffer objects for generated images
	 */
	async sendThreadedPost(chatId: string, messages: string[], imageUrl?: string | Buffer): Promise<void> {
		logger.info({ 
			messageCount: messages.length,
			hasImageUrl: !!imageUrl,
			chatId 
		}, 'Sending threaded post');

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i]!;
			
			// Send image only with the first message
			const shouldIncludeImage = i === 0 && imageUrl;
			
			try {
				await this.sendPostWithImage(chatId, message, shouldIncludeImage ? imageUrl : undefined);
				
				// Add delay between thread messages
				if (i < messages.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
				
			} catch (err) {
				logger.error({ 
					error: err instanceof Error ? err.message : String(err),
					messageIndex: i + 1,
					totalMessages: messages.length 
				}, 'Failed to send thread message');
				
				// Continue with next message even if one fails
			}
		}
		
		logger.info({ 
			messageCount: messages.length,
			chatId 
		}, 'Threaded post sending completed');
	}
}

/**
 * Create a global post service instance (will be initialized with bot instance)
 */
let postService: PostService;

/**
 * Initialize the post service with bot instance
 */
export function initializePostService(bot: Telegraf): void {
	postService = new PostService(bot);
}

/**
 * Get the global post service instance
 */
export function getPostService(): PostService {
	if (!postService) {
		throw new Error('Post service not initialized. Call initializePostService() first.');
	}
	return postService;
}

/**
 * Convenience functions for backward compatibility
 */
export async function createEnhancedPost(article: Article): Promise<string | null> {
	return getPostService().createEnhancedPost(article);
}

export async function sendPostWithImage(chatId: string, message: string, imageUrl?: string | Buffer): Promise<void> {
	return getPostService().sendPostWithImage(chatId, message, imageUrl);
}

/**
 * New convenience functions for threaded posts
 */
export async function createThreadedPost(article: Article): Promise<string[]> {
	return getPostService().createThreadedPost(article);
}

export async function sendThreadedPost(chatId: string, messages: string[], imageUrl?: string | Buffer): Promise<void> {
	return getPostService().sendThreadedPost(chatId, messages, imageUrl);
}

/**
 * Same analysis pipeline as scheduled posts, but always returns HTML (including AI fallback text).
 * Used when we still want to show or send a post after a failed model run.
 */
export async function createEnhancedPostWithFallback(article: Article): Promise<string | null> {
	try {
		const analysis = await getPostReadyAnalysis(article);
		const htmlPost = buildPostHtml(article, analysis);
		logger.info({ title: article.title, postLength: calculateHtmlLength(htmlPost) }, 'Post HTML built for preview/channel');
		return htmlPost;
	} catch (err) {
		logger.error(
			{ err: err instanceof Error ? err.message : String(err), article: article.title },
			'Failed to build post HTML'
		);
		return null;
	}
}