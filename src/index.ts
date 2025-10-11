/**
 * AI Tech News Bot - Main Application Entry Point
 * 
 * This is the new streamlined main file that uses modular architecture.
 * The original index.ts has been refactored into smaller, focused modules.
 */
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { logger } from './logger';
import { counters, startMetricsServer, stopMetricsServer } from './metrics';
import { createMainMenu } from './utils/menu';

// Import modular components
import { registerCommands } from './bot/commands';
import { registerMenuHandlers } from './bot/menu-handlers';
import { startScheduler } from './bot/scheduler';
import { initializePostService } from './services/post-service';
import { setupGlobalErrorHandlers, errorMiddleware, asyncHandler } from './bot/error-handler';
import { printEnvConfig, getEnvConfig } from './utils/env-validator';
import { redditBrowser } from './reddit-browser';

/**
 * Validate and load configuration
 */
function validateConfig(): void {
	try {
		// This will validate all environment variables and throw if invalid
		printEnvConfig();
	} catch (err) {
		logger.fatal({ 
			error: err instanceof Error ? err.message : String(err) 
		}, 'Environment validation failed');
		process.exit(1);
	}
}

/**
 * Get application configuration
 */
const config = {
	get botToken(): string {
		return getEnvConfig().botToken;
	},
	get targetChatId(): string | undefined {
		return getEnvConfig().targetChatId;
	},
	get targetCategory(): string {
		return getEnvConfig().targetCategory;
	},
	get metricsPort(): number {
		return getEnvConfig().metricsPort;
	}
};

/**
 * Initialize and start the bot
 */
async function startBot(): Promise<void> {
	try {
		// Validate configuration
		validateConfig();
		
		// Setup global error handlers
		setupGlobalErrorHandlers();
		
		// Create bot instance with extended timeout (120 seconds for AI processing)
		const bot = new Telegraf(config.botToken!, {
			handlerTimeout: 120000 // 120 seconds (increased from default 90s)
		});
		
		// Initialize services
		initializePostService(bot);
		redditBrowser.setBot(bot);
		startMetricsServer();
		
		// Setup error middleware
		errorMiddleware(bot);
		
		// Global message counter middleware
		bot.use(asyncHandler(async (_ctx, next) => {
			counters.messagesReceived.inc();
			if (next) await next();
		}));
		
		// Register start command
		bot.start(asyncHandler(async (ctx) => {
			counters.commandsHandled.inc({ command: 'start' });
			
			// Send welcome message
			await ctx.reply(
				'🚀 <b>AI Pipeline Bot is online!</b>\n\nWelcome to your AI Tech News hub. Use the menu below to navigate:', 
				{ 
					parse_mode: 'HTML',
					reply_markup: createMainMenu().reply_markup
				}
			);
			
		// Fetch article from a random RSS feed
		try {
			const { DEFAULT_FEEDS, fetchRssFeed } = await import('./data-aggregator');
			const { getSourceDomain } = await import('./utils/time');
			
			// Show loading message
			const loadingMsg = await ctx.reply(
				'🔄 <b>Fetching fresh article...</b>\n\n⏳ Please wait...',
				{ parse_mode: 'HTML' }
			);
			
			// Randomly select one RSS feed
			const randomFeed = DEFAULT_FEEDS[Math.floor(Math.random() * DEFAULT_FEEDS.length)]!;
			const sourceName = getSourceDomain(randomFeed);
			
			logger.info({ feed: randomFeed, source: sourceName }, 'Fetching article from random feed for /start command');
			
			// Fetch articles from the selected feed
			const articles = await fetchRssFeed(randomFeed);
			
			// Delete loading message
			await ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
			
			if (articles.length > 0) {
				// Pick a random article from the fetched ones
				const randomArticle = articles[Math.floor(Math.random() * articles.length)]!;
				
				const headerMessage = 
					`📰 <b>Random Article from ${sourceName}</b>\n` +
					`🎲 Selected from ${articles.length} available article${articles.length === 1 ? '' : 's'}`;
				
				await ctx.reply(headerMessage, { parse_mode: 'HTML' });
				
				const { createEnhancedPostWithFallback, sendPostWithImage } = await import('./services/post-service');
				const message = await createEnhancedPostWithFallback(randomArticle);
				
				if (message) {
					await sendPostWithImage(ctx.chat.id.toString(), message, randomArticle.imageUrl);
				} else {
					await ctx.reply(
						`❌ <b>Unable to Analyze Article</b>\n\n` +
						`<b>Article:</b> ${randomArticle.title}\n\n` +
						`<b>Possible reasons:</b>\n` +
						`• Article may not be AI/tech related\n` +
						`• AI provider may be experiencing issues\n` +
						`• Article content may be too short or unclear\n\n` +
						`<i>Try /start again for a different article!</i>`,
						{ parse_mode: 'HTML' }
					);
				}
			} else {
				await ctx.reply(
					`😕 <b>No Articles Found</b>\n\n` +
					`Could not fetch articles from <b>${sourceName}</b>.\n\n` +
					`<i>Try /start again or use the menu below.</i>`,
					{ 
						parse_mode: 'HTML',
						link_preview_options: { is_disabled: true } 
					}
				);
			}
			
		} catch (err) {
			logger.error({ err }, 'Failed to fetch random article in start command');
			await ctx.reply(
				'❌ <b>Error Fetching Article</b>\n\n' +
				'Something went wrong while fetching a random article. Please try again!',
				{ parse_mode: 'HTML' }
			);
		}
		}));
		
		// Register all command handlers
		registerCommands(bot);
		
		// Register all menu handlers
		registerMenuHandlers(bot);
		
		// Set bot instance for scheduler (needed for preview mode)
		const { setSchedulerBot } = await import('./bot/scheduler');
		setSchedulerBot(bot);
		
		// Register callback handlers for post preview actions
		bot.action(/^confirm_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { confirmPost } = await import('./bot/scheduler');
			const result = await confirmPost(postId);
			await ctx.answerCbQuery();
			
			// Delete the preview message
			try {
				await ctx.deleteMessage();
			} catch (err) {
				logger.warn({ err }, 'Failed to delete preview message after confirmation');
			}
			
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^skip_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { skipPost } = await import('./bot/scheduler');
			const result = await skipPost(postId);
			await ctx.answerCbQuery();
			
			// Delete the preview message
			try {
				await ctx.deleteMessage();
			} catch (err) {
				logger.warn({ err }, 'Failed to delete preview message after skip');
			}
			
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^regenerate_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { regeneratePost } = await import('./bot/scheduler');
			await ctx.answerCbQuery('Regenerating post...');
			
			// Delete the old preview message
			try {
				await ctx.deleteMessage();
			} catch (err) {
				logger.warn({ err }, 'Failed to delete preview message after regenerate');
			}
			
			const result = await regeneratePost(postId);
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^cancel_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { cancelPost } = await import('./bot/scheduler');
			const result = await cancelPost(postId);
			await ctx.answerCbQuery();
			
			// Delete the preview message
			try {
				await ctx.deleteMessage();
			} catch (err) {
				logger.warn({ err }, 'Failed to delete preview message after cancel');
			}
			
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^view_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { viewArticle } = await import('./bot/scheduler');
			const result = await viewArticle(postId);
			await ctx.answerCbQuery();
			
			// Keep the preview visible for "View Original" - just show details
			await ctx.reply(result, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
		}));
		
		// List all pending previews
		bot.action('list_previews', asyncHandler(async (ctx) => {
			const { listPendingPosts } = await import('./bot/scheduler');
			const result = await listPendingPosts();
			await ctx.answerCbQuery();
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		// Start the scheduler for automatic posting
		startScheduler();
		
		// Start the bot
		await bot.launch();
		
		logger.info({
			botUsername: bot.botInfo?.username,
			targetCategory: config.targetCategory,
			metricsPort: config.metricsPort
		}, 'AI Tech News Bot started successfully');
		
		// Graceful shutdown handlers (set up after bot.launch)
		const gracefulShutdown = async (signal: string) => {
			logger.info({ signal }, 'Received shutdown signal, stopping services...');
			
			try {
				// Stop the bot first
				bot.stop(signal);
				logger.info('Bot stopped');
				
				// Stop the metrics server
				await stopMetricsServer();
				logger.info('Metrics server stopped');
				
				logger.info('Graceful shutdown completed');
				process.exit(0);
			} catch (err) {
				logger.error({ err }, 'Error during graceful shutdown');
				process.exit(1);
			}
		};
		
		process.once('SIGINT', () => gracefulShutdown('SIGINT'));
		process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
		
	} catch (error) {
		logger.fatal({ 
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined
		}, 'Failed to start bot');
		process.exit(1);
	}
}

/**
 * Application health check endpoint info
 */
logger.info({
	healthEndpoint: `http://localhost:${config.metricsPort}/health`,
	metricsEndpoint: `http://localhost:${config.metricsPort}/metrics`
}, 'Health and metrics endpoints available');

/**
 * Start the application
 */
startBot().catch((error) => {
	logger.fatal({ 
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined
	}, 'Unhandled error during bot startup');
	process.exit(1);
});

/**
 * Export configuration for testing purposes
 */
export { config };
