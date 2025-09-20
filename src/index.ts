/**
 * AI Tech News Bot - Main Application Entry Point
 * 
 * This is the new streamlined main file that uses modular architecture.
 * The original index.ts has been refactored into smaller, focused modules.
 */
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { logger } from './logger';
import { counters, startMetricsServer } from './metrics';
import { createMainMenu } from './utils/menu';

// Import modular components
import { registerCommands } from './bot/commands';
import { registerMenuHandlers } from './bot/menu-handlers';
import { startScheduler } from './bot/scheduler';
import { initializePostService } from './services/post-service';
import { setupGlobalErrorHandlers, errorMiddleware, asyncHandler } from './bot/error-handler';

/**
 * Application configuration
 */
const config = {
	botToken: process.env.BOT_TOKEN,
	targetChatId: process.env.TELEGRAM_TARGET_CHAT_ID,
	targetCategory: process.env.TARGET_CATEGORY || 'AI Tool',
	metricsPort: Number(process.env.METRICS_PORT) || 3000
};

/**
 * Validate required configuration
 */
function validateConfig(): void {
	if (!config.botToken) {
		logger.error('Missing BOT_TOKEN in environment');
		process.exit(1);
	}
	
	if (!config.targetChatId) {
		logger.warn('TELEGRAM_TARGET_CHAT_ID not set; scheduler will not post to channel');
	}
	
	logger.info({
		targetCategory: config.targetCategory,
		targetChatId: config.targetChatId ? 'configured' : 'not set',
		metricsPort: config.metricsPort
	}, 'Bot configuration loaded');
}

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
				const { createEnhancedPost, sendPostWithImage } = await import('./services/post-service');
				const { formatDistanceToNow } = await import('./utils/time');
				
				// Fetch recent articles and get the most recent one
				const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 });
				
				if (articles.length > 0) {
					const latestArticle = articles[0]!; // Already sorted by newest first
					const timeSinceFetch = formatDistanceToNow(new Date(latestArticle.pubDate));
					const headerMessage = `📰 <b>Latest Fetched Article</b> (${timeSinceFetch} ago):`;
					
					await ctx.reply(headerMessage, { parse_mode: 'HTML' });
					
					const message = await createEnhancedPost(latestArticle);
					if (message) {
						await sendPostWithImage(ctx.chat.id.toString(), message, latestArticle.imageUrl);
					} else {
						await ctx.reply('❌ <b>Analysis Failed</b>\n\nUnable to analyze the latest article. This may indicate an AI analysis issue.', {
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
		
		// Start the scheduler for automatic posting
		startScheduler();
		
		// Graceful shutdown handlers
		process.once('SIGINT', () => {
			logger.info('Received SIGINT, stopping bot...');
			bot.stop('SIGINT');
		});
		
		process.once('SIGTERM', () => {
			logger.info('Received SIGTERM, stopping bot...');
			bot.stop('SIGTERM');
		});
		
		// Start the bot
		await bot.launch();
		
		logger.info({
			botUsername: bot.botInfo?.username,
			targetCategory: config.targetCategory,
			metricsPort: config.metricsPort
		}, 'AI Tech News Bot started successfully');
		
		// Enable graceful stop
		process.once('SIGINT', () => bot.stop('SIGINT'));
		process.once('SIGTERM', () => bot.stop('SIGTERM'));
		
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
