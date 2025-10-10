/**
 * Post creation and formatting service
 */
import { Telegraf } from 'telegraf';
import { Article } from '../types';
import { getPostReadyAnalysis } from '../ai-analysis/optimized';
import { getTimeAgo } from '../utils/time';
import { calculateHtmlLength, splitIntoThreads, buildHtmlPost, LIMITS } from '../utils/html-utils';
import { logger } from '../logger';

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
			// Use optimized AI analysis with caching
			logger.info({ title: article.title }, 'Generating optimized AI analysis for post');
			const analysis = await getPostReadyAnalysis(article);
			
			// Check if analysis is fallback - skip posting if so
			if (analysis.isFallback) {
				logger.warn({ 
					title: article.title
				}, 'Skipping post due to fallback analysis - AI analysis failed');
				return null;
			}
			
			logger.info({ 
				title: article.title, 
				hasDescription: !!analysis.description,
				hashtagCount: analysis.hashtags.length
			}, 'Optimized AI analysis completed');
			
			const timeAgo = getTimeAgo(article.pubDate);
			
			// Format content
			const formattedTldr = analysis.tldr;
			const formattedDescription = analysis.description;
			const formattedBullets = analysis.bullets || [];
			const formattedBusinessImpact = analysis.business_implication?.trim() || '';
			
			// Check if business impact is valuable (simple check for non-empty and meaningful content)
			const isValueableBusinessImpact = formattedBusinessImpact.length > 20;
			
			// Build HTML post using utility function
			const htmlPost = buildHtmlPost({
				tldr: formattedTldr,
				bullets: formattedBullets,
				businessImpact: isValueableBusinessImpact ? formattedBusinessImpact : '',
				description: formattedDescription,
				hashtags: analysis.hashtags,
				timeAgo,
				link: article.link,
				...(article.externalLink && { externalLink: article.externalLink }),
				isPersian: false,
				maxLength: LIMITS.SINGLE_POST
			});
			
			const postLength = calculateHtmlLength(htmlPost);
			
			logger.info({ 
				title: article.title, 
				postLength,
				hasBusinessImpact: isValueableBusinessImpact 
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
	 */
	async sendPostWithImage(chatId: string, message: string, imageUrl?: string): Promise<void> {
		const messageLength = calculateHtmlLength(message);
		
		logger.info({ 
			hasImageUrl: !!imageUrl, 
			imageUrl: imageUrl?.substring(0, 100) + '...',
			messageLength,
			htmlLength: messageLength,
			chatId 
		}, 'Attempting to send HTML post with image');

		if (imageUrl && imageUrl.trim()) {
			try {
				// Validate image URL
				if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
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
					
					await this.bot.telegram.sendPhoto(chatId, imageUrl, {
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
					imageUrl: imageUrl.substring(0, 100) + '...',
					messageLength 
				}, 'Sending photo with HTML caption to Telegram');
				
				const photoOptions = {
					caption: message,
					parse_mode: 'HTML' as const,
				};

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
			} catch (err) {
				// If image fails, fall back to text only
				const errorMsg = err instanceof Error ? err.message : String(err);
				logger.warn({ 
					error: errorMsg, 
					imageUrl: imageUrl?.substring(0, 100) + '...' 
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
	 */
	async sendThreadedPost(chatId: string, messages: string[], imageUrl?: string): Promise<void> {
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

export async function sendPostWithImage(chatId: string, message: string, imageUrl?: string): Promise<void> {
	return getPostService().sendPostWithImage(chatId, message, imageUrl);
}

/**
 * New convenience functions for threaded posts
 */
export async function createThreadedPost(article: Article): Promise<string[]> {
	return getPostService().createThreadedPost(article);
}

export async function sendThreadedPost(chatId: string, messages: string[], imageUrl?: string): Promise<void> {
	return getPostService().sendThreadedPost(chatId, messages, imageUrl);
}

/**
 * Create enhanced post with automatic provider fallback retry logic
 * This function directly uses the enhanced fallback analysis for better reliability
 */
export async function createEnhancedPostWithFallback(article: Article): Promise<string | null> {
	try {
		// Use the enhanced fallback analysis directly from providers
		const { analyzeWithFallback } = await import('../ai-analysis/providers');
		const { sanitizeAnalysisResult } = await import('../utils/sanitizer');
		
		logger.info({ title: article.title }, 'Creating enhanced post with fallback retry logic');
		
		const rawResult = await analyzeWithFallback(article, undefined, {
			maxRetries: 2,
			retryDelay: 1000,
			timeout: 30000
		});
		
		// Sanitize the result
		const sanitized = sanitizeAnalysisResult(rawResult);
		
		if (!sanitized) {
			logger.warn({ title: article.title }, 'Sanitized result is null');
			return null;
		}
		
		const timeAgo = getTimeAgo(article.pubDate);
		
		// Build HTML post using utility function
		const htmlPost = buildHtmlPost({
			tldr: sanitized.tldr || `Latest: ${article.title}`,
			bullets: sanitized.bullets || [],
			businessImpact: sanitized.business_implication || '',
			description: sanitized.description || `${article.title} - This development could have implications for the tech industry.`,
			hashtags: sanitized.hashtags || ['AI', 'TechNews', 'Innovation'],
			timeAgo,
			link: article.link,
			...(article.externalLink && { externalLink: article.externalLink }),
			isPersian: false,
			maxLength: LIMITS.SINGLE_POST
		});
		
		logger.info({ 
			title: article.title,
			postLength: calculateHtmlLength(htmlPost)
		}, 'Enhanced post created successfully with fallback retry logic');
		
		return htmlPost;
		
	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err), 
			article: article.title
		}, 'Failed to create enhanced post with fallback - all providers exhausted');
		
		// Don't create fallback post - return null to skip posting
		return null;
	}
}