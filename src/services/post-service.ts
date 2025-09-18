/**
 * Post creation and formatting service
 */
import { Telegraf } from 'telegraf';
import { Article } from '../types';
import { getPostReadyAnalysis } from '../ai-analysis/optimized';
import { getTimeAgo } from '../utils/time';
import { isPersianText, isValuableBusinessImpact, getLabels } from '../utils/persian-utils';
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
	 * Shorten a URL for display purposes
	 */
	private shortenLink(url: string, maxLength: number = 60): string {
		try {
			const urlObj = new URL(url);
			const domain = urlObj.hostname.replace(/^www\./, '');
			const path = urlObj.pathname + urlObj.search;
			
			if (domain.length + path.length <= maxLength) {
				return domain + path;
			}
			
			const availableSpace = maxLength - domain.length - 3; // 3 for "..."
			if (availableSpace > 10) {
				return domain + path.substring(0, availableSpace) + '...';
			}
			
			return domain;
		} catch {
			// If URL parsing fails, just truncate
			return url.length > maxLength ? url.substring(0, maxLength - 3) + '...' : url;
		}
	}

	/**
	 * Create an enhanced post with AI analysis and proper formatting
	 */
	async createEnhancedPost(article: Article, translateToPersian: boolean = true): Promise<string> {
		try {
			// Use optimized AI analysis with caching
			logger.info({ title: article.title, translateToPersian }, 'Generating optimized AI analysis for post');
			const analysis = await getPostReadyAnalysis(article, translateToPersian);
			logger.info({ 
				title: article.title, 
				hasDescription: !!analysis.description,
				hashtagCount: analysis.hashtags.length,
				translateToPersian
			}, 'Optimized AI analysis completed');
			
			// Detect if content is in Persian (either original or translated)
			const isPersian = isPersianText(article.title + ' ' + analysis.tldr + ' ' + analysis.description) || translateToPersian;
			
			// Build the enhanced post with tldr, bullets, business_implication, and more
			const hashtags = analysis.hashtags.length > 0 
				? '\n\n' + analysis.hashtags.map(tag => `#${tag}`).join(' ')
				: '';
			
			const shortLink = this.shortenLink(article.link);
			const timeAgo = getTimeAgo(article.pubDate);
			
			// Build bullets section
			const bulletsSection = analysis.bullets && analysis.bullets.length > 0
				? '\n\n🔸 ' + analysis.bullets.join('\n🔸 ')
				: '';
			
			// Build business implication section (only when valuable)
			const businessImpact = analysis.business_implication?.trim() || '';
			const isValueableBusinessImpact = isValuableBusinessImpact(businessImpact, isPersian);
			const labels = getLabels(isPersian);

			const businessSection = isValueableBusinessImpact
				? `\n\n${labels.BUSINESS_IMPACT} ${businessImpact}`
				: '';
			
			logger.debug({
				title: article.title?.substring(0, 50),
				hasBusinessImpact: !!businessImpact,
				isValuable: isValueableBusinessImpact,
				businessImpactLength: businessImpact.length,
				isPersian: isPersian,
				translateToPersian
			}, 'Business impact evaluation');
			
			const enhancedPost = `💡 ${analysis.tldr}${bulletsSection}${businessSection}

${analysis.description}${hashtags}

⏰ ${timeAgo}
🔗 ${shortLink}`;

			logger.info({ title: article.title, postLength: enhancedPost.length, isPersian, translateToPersian }, 'Enhanced post created successfully');
			return enhancedPost;
			
		} catch (err) {
			logger.error({ 
				err: err instanceof Error ? err.message : String(err), 
				article: article.title,
				translateToPersian
			}, 'Failed to create enhanced post, using fallback');
			
			// Fallback to simple format if AI analysis fails
			const shortLink = this.shortenLink(article.link);
			const timeAgo = getTimeAgo(article.pubDate);
			const isPersian = isPersianText(article.title) || translateToPersian;
			const labels = getLabels(isPersian);
			
			const fallbackTitle = isPersian 
				? '💡 آخرین تحول در حوزه هوش مصنوعی و فناوری'
				: '💡 Latest development in AI/tech space';
			
			const bulletPoints = '\n\n🔸 ' + labels.FALLBACK_BULLETS.join('\n🔸 ');
			
			return `${fallbackTitle}${bulletPoints}

⏰ ${timeAgo}
🔗 ${shortLink}`;
		}
	}

	/**
	 * Send a post with optional image, handling Telegram's limitations
	 */
	async sendPostWithImage(chatId: string, message: string, imageUrl?: string): Promise<void> {
		logger.info({ 
			hasImageUrl: !!imageUrl, 
			imageUrl: imageUrl?.substring(0, 100) + '...',
			messageLength: message.length,
			chatId 
		}, 'Attempting to send post with image');

		if (imageUrl && imageUrl.trim()) {
			try {
				// Validate image URL
				if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
					logger.warn({ imageUrl }, 'Invalid image URL format, falling back to text');
					throw new Error('Invalid URL format');
				}

				// Check if message is too long for Telegram caption (1024 char limit)
				if (message.length > 1024) {
					logger.info({ 
						messageLength: message.length,
						limit: 1024 
					}, 'Message too long for caption, splitting into image + text');
					
					// Send image with short caption, then send full text
					const shortCaption = '📰 Latest AI Tech News';
					
					await this.bot.telegram.sendPhoto(chatId, imageUrl, {
						caption: shortCaption,
						parse_mode: 'Markdown',
					});
					
					// Send full message as separate text
					await this.bot.telegram.sendMessage(chatId, message, { 
						link_preview_options: { is_disabled: true },
						parse_mode: 'Markdown'
					});
					
					logger.info('Photo and text sent successfully (split method)');
					return;
				}

				// Try to send with image first (if message is short enough)
				logger.info({ 
					imageUrl: imageUrl.substring(0, 100) + '...',
					messageLength: message.length 
				}, 'Sending photo with caption to Telegram');
				
				const photoOptions = {
					caption: message,
					parse_mode: 'Markdown' as const,
				};

				// Method 1: Direct URL
				try {
					await this.bot.telegram.sendPhoto(chatId, imageUrl, photoOptions);
					logger.info('Photo sent successfully via direct URL');
				} catch (directError) {
					logger.warn({ error: String(directError) }, 'Direct URL failed, trying with Input object');
					
					// Method 2: Using Input object (sometimes works better)
					await this.bot.telegram.sendPhoto(chatId, { url: imageUrl }, photoOptions);
					logger.info('Photo sent successfully via Input object');
				}
			} catch (err) {
				// If image fails, fall back to text only
				const errorMsg = err instanceof Error ? err.message : String(err);
				logger.warn({ 
					error: errorMsg, 
					imageUrl: imageUrl?.substring(0, 100) + '...' 
				}, 'Failed to send image, falling back to text');
				
				await this.bot.telegram.sendMessage(chatId, message, { 
					link_preview_options: { is_disabled: true },
					parse_mode: 'Markdown'
				});
			}
		} else {
			// No image, send text only
			logger.info('No image URL provided, sending text only');
			await this.bot.telegram.sendMessage(chatId, message, { 
				link_preview_options: { is_disabled: true },
				parse_mode: 'Markdown'
			});
		}
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
export async function createEnhancedPost(article: Article, translateToPersian?: boolean): Promise<string> {
	return getPostService().createEnhancedPost(article, translateToPersian);
}

export async function sendPostWithImage(chatId: string, message: string, imageUrl?: string): Promise<void> {
	return getPostService().sendPostWithImage(chatId, message, imageUrl);
}
