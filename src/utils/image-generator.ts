/**
 * Image Generator - Create template images for Reddit posts without images
 * Uses @napi-rs/canvas for high-performance image generation
 */

import { createCanvas } from '@napi-rs/canvas';
import { Article } from '../types';
import { logger } from '../logger';

export interface TemplateImageOptions {
	subreddit: string;
	category: string;
	title: string;
	timeAgo?: string;
}

// Category color schemes - vibrant and modern
const CATEGORY_COLORS: Record<string, { bg: string; accent: string; emoji: string }> = {
	'AI Tool': { bg: '#667eea', accent: '#764ba2', emoji: '🤖' },
	'AI News': { bg: '#f093fb', accent: '#f5576c', emoji: '📰' },
	'Business': { bg: '#4facfe', accent: '#00f2fe', emoji: '💼' },
	'Developer': { bg: '#43e97b', accent: '#38f9d7', emoji: '👨‍💻' },
	'Tech News': { bg: '#fa709a', accent: '#fee140', emoji: '⚡' },
	'Default': { bg: '#667eea', accent: '#764ba2', emoji: '🔥' }
};

/**
 * Generate a beautiful template image for Reddit posts
 */
export async function generateTemplateImage(
	options: TemplateImageOptions
): Promise<Buffer> {
	const { subreddit, category, title } = options;
	
	try {
		// Canvas size optimized for Telegram (1.91:1 aspect ratio)
		const width = 1200;
		const height = 630;
		
		const canvas = createCanvas(width, height);
		const ctx = canvas.getContext('2d');
		
		// Get colors for this category
		const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS['Default']!;
		
		// === BACKGROUND ===
		// Create gradient background
		const gradient = ctx.createLinearGradient(0, 0, width, height);
		gradient.addColorStop(0, colors.bg);
		gradient.addColorStop(1, colors.accent);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, width, height);
		
		// Add noise texture effect (semi-transparent overlay)
		ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
		ctx.fillRect(0, 0, width, height);
		
		// Add decorative circles for visual interest
		ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.beginPath();
		ctx.arc(width - 200, 100, 300, 0, Math.PI * 2);
		ctx.fill();
		
		ctx.beginPath();
		ctx.arc(100, height - 100, 200, 0, Math.PI * 2);
		ctx.fill();
		
		// === SUBREDDIT BADGE ===
		const badgeX = 60;
		const badgeY = 60;
		const badgeHeight = 60;
		
		// Badge background
		ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
		ctx.beginPath();
		ctx.roundRect(badgeX, badgeY, subreddit.length * 18 + 80, badgeHeight, 30);
		ctx.fill();
		
		// Reddit icon emoji
		ctx.font = '32px Arial';
		ctx.fillText('🔴', badgeX + 15, badgeY + 43);
		
		// Subreddit name
		ctx.font = 'bold 28px Arial';
		ctx.fillStyle = colors.accent;
		ctx.fillText(`r/${subreddit}`, badgeX + 60, badgeY + 43);
		
		// === TITLE ===
		const titleX = 60;
		let titleY = height / 2 - 40;
		const maxTitleWidth = width - 120;
		const lineHeight = 65;
		
		// Set title font
		ctx.font = 'bold 52px Arial';
		ctx.fillStyle = '#ffffff';
		ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
		ctx.shadowBlur = 10;
		ctx.shadowOffsetX = 2;
		ctx.shadowOffsetY = 2;
		
		// Word wrap the title
		const words = title.split(' ');
		let line = '';
		let lineCount = 0;
		const maxLines = 3;
		
		for (let i = 0; i < words.length && lineCount < maxLines; i++) {
			const word = words[i]!;
			const testLine = line + word + ' ';
			const metrics = ctx.measureText(testLine);
			
			if (metrics.width > maxTitleWidth && line !== '') {
				// Draw this line
				ctx.fillText(line.trim(), titleX, titleY);
				line = word + ' ';
				titleY += lineHeight;
				lineCount++;
				
				// Add ellipsis if we're on the last line and there are more words
				if (lineCount === maxLines - 1 && i < words.length - 2) {
					line += '...';
					break;
				}
			} else {
				line = testLine;
			}
		}
		
		// Draw the last line
		if (lineCount < maxLines) {
			ctx.fillText(line.trim(), titleX, titleY);
		}
		
		// Reset shadow
		ctx.shadowColor = 'transparent';
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
		
		// === CHANNEL BRANDING AT BOTTOM ===
		const channelBadgeY = height - 90;
		const channelText = 'AI Vision 2030';
		
		// Measure channel text width
		ctx.font = 'bold 28px Arial';
		const channelWidth = ctx.measureText(channelText).width + 80;
		
		// Channel badge background with gradient
		const channelGradient = ctx.createLinearGradient(60, channelBadgeY, 60 + channelWidth, channelBadgeY + 50);
		channelGradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
		channelGradient.addColorStop(1, 'rgba(255, 255, 255, 0.85)');
		ctx.fillStyle = channelGradient;
		ctx.beginPath();
		ctx.roundRect(60, channelBadgeY, channelWidth, 50, 25);
		ctx.fill();
		
		// Add subtle border
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(60, channelBadgeY, channelWidth, 50, 25);
		ctx.stroke();
		
		// Channel text with gradient
		const textGradient = ctx.createLinearGradient(80, channelBadgeY + 10, 80 + channelWidth - 40, channelBadgeY + 40);
		textGradient.addColorStop(0, colors.accent);
		textGradient.addColorStop(1, colors.bg);
		ctx.fillStyle = textGradient;
		ctx.font = 'bold 28px Arial';
		ctx.fillText(channelText, 80, channelBadgeY + 35);
		
		// Add small AI icon/emoji next to text
		ctx.font = '24px Arial';
		ctx.fillText('🚀', 50, channelBadgeY + 35);
		
		// Convert canvas to PNG buffer
		const buffer = canvas.toBuffer('image/png');
		
		logger.info({
			subreddit,
			category,
			titleLength: title.length,
			imageSize: buffer.length
		}, 'Generated template image successfully');
		
		return buffer;
		
	} catch (err) {
		logger.error({
			err: err instanceof Error ? err.message : String(err),
			subreddit,
			category
		}, 'Failed to generate template image');
		
		throw err;
	}
}

/**
 * Extract subreddit name from Reddit URL
 */
export function extractSubreddit(redditUrl: string): string {
	const match = redditUrl.match(/reddit\.com\/r\/([^\/\?]+)/i);
	return match ? match[1]! : 'reddit';
}

/**
 * Determine category from article or default
 */
export function determineCategory(article: Article): string {
	// If article has a category field, use it
	if (article.category) {
		return article.category;
	}
	
	// Try to infer from title or content
	const text = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
	
	if (text.includes('tool') || text.includes('app') || text.includes('platform')) {
		return 'AI Tool';
	}
	
	if (text.includes('business') || text.includes('enterprise') || text.includes('market')) {
		return 'Business';
	}
	
	if (text.includes('developer') || text.includes('programming') || text.includes('code')) {
		return 'Developer';
	}
	
	if (text.includes('news') || text.includes('announce') || text.includes('launch')) {
		return 'AI News';
	}
	
	// Default
	return 'Tech News';
}

