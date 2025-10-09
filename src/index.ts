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
		
		// Create bot instance
		const bot = new Telegraf(config.botToken!);
		
		// Initialize services
		initializePostService(bot);
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
			
			// Show the last fetched article
			try {
				const { fetchAllArticles } = await import('./data-aggregator');
				const { formatDistanceToNow } = await import('./utils/time');
				
				// Fetch recent articles and get the most recent one
				const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 });
				
				if (articles.length > 0) {
					const latestArticle = articles[0]!; // Already sorted by newest first
					const timeSinceFetch = formatDistanceToNow(new Date(latestArticle.pubDate));
					const headerMessage = `📰 <b>Latest Fetched Article</b> (${timeSinceFetch} ago):`;
					
				await ctx.reply(headerMessage, { parse_mode: 'HTML' });
				
				const { createEnhancedPost, sendPostWithImage } = await import('./services/post-service');
				const message = await createEnhancedPost(latestArticle);
				if (message) {
						await sendPostWithImage(ctx.chat.id.toString(), message, latestArticle.imageUrl);
					} else {
						await ctx.reply(`❌ <b>Unable to Analyze Article</b>\n\n<b>Article:</b> ${latestArticle.title}\n\n<b>Possible reasons:</b>\n• Article may not be AI/tech related\n• AI provider may be experiencing issues\n• Article content may be too short or unclear\n\n<i>Try using /fetchfeed to get articles from a specific source.</i>`, {
							parse_mode: 'HTML'
						});
					}
				} else {
					await ctx.reply('📰 <b>No recent articles have been fetched yet.</b>', { 
						parse_mode: 'HTML',
						link_preview_options: { is_disabled: true } 
					});
				}
				
			} catch (err) {
				logger.error({ err }, 'Failed to show latest fetched article in start command');
				await ctx.reply('📰 <b>Unable to retrieve latest fetched article.</b>', { 
					parse_mode: 'HTML' 
				});
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
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^skip_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { skipPost } = await import('./bot/scheduler');
			const result = await skipPost(postId);
			await ctx.answerCbQuery();
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^regenerate_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { regeneratePost } = await import('./bot/scheduler');
			await ctx.answerCbQuery('Regenerating post...');
			const result = await regeneratePost(postId);
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^cancel_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { cancelPost } = await import('./bot/scheduler');
			const result = await cancelPost(postId);
			await ctx.answerCbQuery();
			await ctx.reply(result, { parse_mode: 'HTML' });
		}));
		
		bot.action(/^view_(.+)$/, asyncHandler(async (ctx) => {
			const postId = ctx.match[1]!;
			const { viewArticle } = await import('./bot/scheduler');
			const result = await viewArticle(postId);
			await ctx.answerCbQuery();
			await ctx.reply(result, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
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
