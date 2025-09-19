/**
 * Bot command handlers - extracted from main index.ts
 */
import { Telegraf } from 'telegraf';
import { logger } from '../logger';
import { counters } from '../metrics';
import { createMainMenu } from '../utils/menu';
import { fetchAllArticles } from '../data-aggregator';
import { getPostReadyAnalysis, getAnalysisMetrics } from '../ai-analysis/optimized';
import { getTimeAgo, getSourceDomain } from '../utils/time';
import { toggleAutoPosting, getSchedulerStatus } from './scheduler';

/**
 * Post creation and sending functions (will be moved to post service later)
 */
declare function createEnhancedPost(article: any, translateToPersian?: boolean): Promise<string>;
declare function sendPostWithImage(chatId: string, message: string, imageUrl?: string): Promise<void>;
declare function shortenLink(url: string, maxLength?: number): string;

/**
 * Register all bot commands
 */
export function registerCommands(bot: Telegraf) {
	
	bot.command('fetchfeed', async (ctx) => {
		counters.commandsHandled.inc({ command: 'fetchfeed' });
		try {
			const args = ctx.message.text.split(' ').slice(1);
			
			if (args.length === 0) {
				// Show available feeds
				let report = `📡 <b>Fetch From Specific Feed</b>\n\n`;
				report += `Usage: <code>/fetchfeed &lt;source&gt;</code>\n\n`;
				report += `Available sources:\n`;
				report += `• <code>techcrunch</code> - TechCrunch AI\n`;
				report += `• <code>openai</code> - OpenAI Blog\n`;
				report += `• <code>venturebeat</code> - VentureBeat AI\n`;
				report += `• <code>theverge</code> - The Verge\n`;
				report += `• <code>huggingface</code> - Hugging Face Blog\n`;
				report += `• <code>google</code> - Google AI Blog\n\n`;
				report += `Example: <code>/fetchfeed huggingface</code>`;
				
				await ctx.reply(report, {
					parse_mode: 'HTML',
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}
			
			const source = args[0]!.toLowerCase();
			
			// Map source names to feed URLs
			const feedMap: { [key: string]: string } = {
				'techcrunch': 'https://techcrunch.com/tag/artificial-intelligence/feed/',
				'openai': 'https://openai.com/blog/rss.xml',
				'venturebeat': 'https://venturebeat.com/category/ai/feed/',
				'theverge': 'https://www.theverge.com/rss/index.xml',
				'huggingface': 'https://huggingface.co/blog/feed.xml',
				'google': 'https://blog.google/technology/ai/rss/'
			};
			
			const feedUrl = feedMap[source];
			if (!feedUrl) {
				await ctx.reply(`❌ <b>Unknown Source</b>: "${source}"\n\nUse <code>/fetchfeed</code> without arguments to see available sources.`, {
					parse_mode: 'HTML',
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}
			
			await ctx.reply(`🔄 <b>Fetching latest post from ${source}...</b>`, { parse_mode: 'HTML' });
			
			// Import the fetch function
			const { fetchRssFeed } = await import('../data-aggregator');
			const { createEnhancedPost, sendPostWithImage } = await import('../services/post-service');
			
			// Fetch articles from the specific feed
			const articles = await fetchRssFeed(feedUrl);
			
			if (articles.length === 0) {
				await ctx.reply(`📭 <b>No articles found</b> from ${source}.`, {
					parse_mode: 'HTML',
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}
			
			// Get the most recent article
			const latestArticle = articles[0]!;
			const sourceName = getSourceDomain(latestArticle.link);
			
			// Send header
			const headerMessage = `📡 <b>Latest from ${sourceName}:</b>`;
			await ctx.reply(headerMessage, { parse_mode: 'HTML' });
			
			// Create and send the enhanced post
			const message = await createEnhancedPost(latestArticle);
			await sendPostWithImage(ctx.chat!.id.toString(), message, latestArticle.imageUrl);
			
			logger.info({ 
				source, 
				feedUrl, 
				title: latestArticle.title,
				articlesFound: articles.length 
			}, 'fetchfeed command completed');
			
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			await ctx.reply(`❌ **Failed to fetch feed:** ${errorMsg}`, {
				reply_markup: createMainMenu().reply_markup
			});
			logger.error({ err }, 'fetchfeed command failed');
		}
	});

	bot.command('analyze', async (ctx) => {
		counters.commandsHandled.inc({ command: 'analyze' });
		try {
			await ctx.reply('🤖 **AI Analysis**\n\nAnalyzing latest article with AI...');
			
			const articles = await fetchAllArticles();
			if (articles.length === 0) {
				await ctx.reply('No articles available for analysis.');
				return;
			}
			
			const article = articles[0]!;
			const analysis = await getPostReadyAnalysis(article);
			const metrics = getAnalysisMetrics();
			
			let report = `🧠 **AI Analysis Result:**\n\n`;
			report += `📰 **Article:** ${article.title}\n`;
			report += `🌐 **Source:** ${getSourceDomain(article.link)}\n`;
			report += `⏰ **Published:** ${getTimeAgo(article.pubDate)}\n\n`;
			
			report += `💡 **TL;DR:** ${analysis.tldr}\n\n`;
			
			if (analysis.bullets && analysis.bullets.length > 0) {
				report += `🔸 **Key Points:**\n`;
				analysis.bullets.forEach(bullet => {
					report += `  • ${bullet}\n`;
				});
				report += '\n';
			}
			
			if (analysis.business_implication && analysis.business_implication.trim()) {
				report += `💼 **Business Impact:** ${analysis.business_implication}\n\n`;
			}
			
			report += `🎯 **Target Audience:** ${analysis.target_audience}\n\n`;
			report += `📝 **Description:** ${analysis.description}\n\n`;
			
			if (analysis.hashtags && analysis.hashtags.length > 0) {
				report += `🏷️ **Hashtags:** ${analysis.hashtags.map(tag => `#${tag}`).join(' ')}\n\n`;
			}
			
			report += `📊 **Performance Metrics:**\n`;
			report += `• Cache hit rate: ${metrics.cacheHitRate.toFixed(1)}%\n`;
			report += `• Average latency: ${metrics.avgLatency.toFixed(0)}ms\n`;
			report += `• Total requests: ${metrics.totalRequests}\n`;
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
			
		} catch (err) {
			counters.errorsTotal.inc({ scope: 'analyze' });
			await ctx.reply('Failed to analyze article.');
			logger.error({ err }, 'analyze command failed');
		}
	});

	bot.command('testpost', async (ctx) => {
		counters.commandsHandled.inc({ command: 'testpost' });
		try {
			await ctx.reply('Creating enhanced test post...');
			const articles = await fetchAllArticles();
			if (articles.length === 0) {
				await ctx.reply('No articles available for testing.');
				return;
			}
			
			const testArticle = articles[0]!;
			const message = await createEnhancedPost(testArticle);
			await sendPostWithImage(ctx.chat.id.toString(), message, testArticle.imageUrl);
			
			logger.info({ title: testArticle.title }, 'test post created successfully');
		} catch (err) {
			counters.errorsTotal.inc({ scope: 'testpost' });
			await ctx.reply('Failed to create test post.');
			logger.error({ err }, 'testpost command failed');
		}
	});

	bot.command('testpersian', async (ctx) => {
		counters.commandsHandled.inc({ command: 'testpersian' });
		try {
			// Create a test Persian article
			const testPersianArticle = {
				title: 'راه‌اندازی مدل جدید هوش مصنوعی توسط شرکت ایرانی',
				link: 'https://example.com/persian-ai-news',
				contentSnippet: 'شرکت فناوری ایرانی امروز از راه‌اندازی مدل جدید هوش مصنوعی خبر داد که قابلیت‌های پیشرفته‌ای در پردازش زبان فارسی دارد. این مدل می‌تواند در صنایع مختلف از جمله بانکداری، آموزش و خدمات مشتریان مورد استفاده قرار گیرد.',
				pubDate: new Date().toISOString(),
				imageUrl: undefined
			};
			
			await ctx.reply('🧪 **Testing Persian Language Analysis**\n\nGenerating AI-enhanced post for Persian content...');
			
			const message = await createEnhancedPost(testPersianArticle);
			
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			
			await ctx.reply('✅ **Persian Test Complete!**\n\nThis demonstrates how the bot analyzes and formats Persian content with appropriate language detection and business impact evaluation.', {
				reply_markup: createMainMenu().reply_markup
			});
			
		} catch (err) {
			await ctx.reply(`Persian test failed: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.command('testtranslate', async (ctx) => {
		counters.commandsHandled.inc({ command: 'testtranslate' });
		try {
			// Create a test English article
			const testEnglishArticle = {
				title: 'OpenAI Announces Major Breakthrough in AI Model Performance',
				link: 'https://example.com/english-ai-news',
				contentSnippet: 'OpenAI has announced a significant breakthrough in their latest AI model, achieving unprecedented performance in natural language understanding and generation. The new model demonstrates improved capabilities in reasoning, creativity, and problem-solving across various domains.',
				pubDate: new Date().toISOString(),
				imageUrl: undefined
			};
			
			await ctx.reply('🌐 **Testing English to Persian Translation**\n\nTranslating and analyzing English content to Persian...');
			
			const message = await createEnhancedPost(testEnglishArticle, true); // Explicitly request Persian translation
			
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			
			await ctx.reply('✅ **Translation Test Complete!**\n\nThis demonstrates how the bot translates English content to Persian with full AI analysis, business impact evaluation, and proper formatting.', {
				reply_markup: createMainMenu().reply_markup
			});
			
		} catch (err) {
			await ctx.reply(`Translation test failed: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.command('testenglish', async (ctx) => {
		counters.commandsHandled.inc({ command: 'testenglish' });
		try {
			// Create a test English article
			const testEnglishArticle = {
				title: 'Meta Unveils Advanced AI Assistant for Businesses',
				link: 'https://example.com/meta-ai-business',
				contentSnippet: 'Meta has launched a new AI assistant specifically designed for business applications, featuring advanced natural language processing capabilities and integration with popular business tools. The assistant aims to improve productivity and streamline workflows.',
				pubDate: new Date().toISOString(),
				imageUrl: undefined
			};
			
			await ctx.reply('🇺🇸 **Testing English Language Post**\n\nGenerating AI-enhanced post in English...');
			
			const message = await createEnhancedPost(testEnglishArticle, false); // Request English analysis
			
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			
			await ctx.reply('✅ **English Test Complete!**\n\nThis demonstrates how the bot analyzes and formats content in English when specifically requested.', {
				reply_markup: createMainMenu().reply_markup
			});
			
		} catch (err) {
			await ctx.reply(`English test failed: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Performance and admin commands
	bot.command('performance', async (ctx) => {
		counters.commandsHandled.inc({ command: 'performance' });
		await ctx.reply('📊 Loading performance statistics...');
		try {
			const metrics = getAnalysisMetrics();
			const { getAnalysisCacheStats } = await import('../storage/analysis-cache');
			const cacheStats = await getAnalysisCacheStats();
			
			let report = '⚡ Performance Optimization Status:\n\n';
			
			// Analysis Metrics
			report += '🧠 AI Analysis Performance:\n';
			report += `📊 Total Requests: ${metrics.totalRequests}\n`;
			report += `💾 Cache Hits: ${metrics.cacheHits} (${metrics.cacheHitRate.toFixed(1)}%)\n`;
			report += `🔥 Cache Misses: ${metrics.cacheMisses}\n`;
			report += `🌐 API Calls: ${metrics.apiCalls}\n`;
			report += `⚡ Avg Latency: ${metrics.avgLatency.toFixed(0)}ms\n`;
			report += `❌ Error Rate: ${metrics.errorRate.toFixed(1)}%\n\n`;
			
			// Cache Statistics
			report += '🗄️ Analysis Cache Stats:\n';
			report += `💾 Cached Analyses: ${cacheStats.totalCached}\n`;
			if (cacheStats.oldestEntry) {
				const oldestDate = new Date(cacheStats.oldestEntry);
				report += `📅 Oldest: ${oldestDate.toLocaleDateString()}\n`;
			}
			if (cacheStats.newestEntry) {
				const newestDate = new Date(cacheStats.newestEntry);
				report += `🆕 Newest: ${newestDate.toLocaleDateString()}\n`;
			}
			
			// Performance Benefits
			report += '\n💰 Cost Savings:\n';
			const savedCalls = metrics.cacheHits;
			const estimatedSavings = savedCalls * 0.001; // Rough estimate
			report += `💸 API Calls Saved: ${savedCalls}\n`;
			report += `💰 Est. Cost Saved: $${estimatedSavings.toFixed(3)}\n\n`;
			
			// Optimization Tips
			if (metrics.cacheHitRate < 50) {
				report += '💡 Tip: Cache hit rate is low. Consider increasing cache size.\n';
			} else if (metrics.cacheHitRate > 80) {
				report += '✅ Excellent cache performance! System is well optimized.\n';
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply(`Performance check failed: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Cache management commands
	bot.command('resetcache', async (ctx) => {
		counters.commandsHandled.inc({ command: 'resetcache' });
		try {
			const fs = require('fs');
			const path = require('path');
			
			const analysisCacheFile = path.join(process.cwd(), 'data', 'analysis-cache.json');
			
			if (fs.existsSync(analysisCacheFile)) {
				fs.unlinkSync(analysisCacheFile);
				await ctx.reply('✅ **Analysis Cache Cleared!**\n\nThe AI analysis cache has been reset. All future analyses will be fresh.', {
					reply_markup: createMainMenu().reply_markup
				});
			} else {
				await ctx.reply('ℹ️ **Cache Already Empty**\n\nNo analysis cache found to clear.', {
					reply_markup: createMainMenu().reply_markup
				});
			}
			
		} catch (err) {
			await ctx.reply(`Failed to clear cache: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.command('cleanseen', async (ctx) => {
		counters.commandsHandled.inc({ command: 'cleanseen' });
		try {
			const fs = require('fs');
			const path = require('path');
			
			const postedFile = path.join(process.cwd(), 'data', 'posted.json');
			
			if (fs.existsSync(postedFile)) {
				fs.unlinkSync(postedFile);
				await ctx.reply('✅ **Seen Articles Cleared!**\n\nAll articles will now be treated as new and available for posting again.', {
					reply_markup: createMainMenu().reply_markup
				});
			} else {
				await ctx.reply('ℹ️ **No Seen Articles Found**\n\nSeen articles list is already empty.', {
					reply_markup: createMainMenu().reply_markup
				});
			}
			
		} catch (err) {
			await ctx.reply(`Failed to clear seen articles: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Channel management commands
	bot.command('deletechannel', async (ctx) => {
		counters.commandsHandled.inc({ command: 'deletechannel' });
		try {
			const targetChatId = process.env.TELEGRAM_TARGET_CHAT_ID;
			
			if (!targetChatId) {
				await ctx.reply('❌ **No Target Channel Configured**\n\nPlease set TELEGRAM_TARGET_CHAT_ID in your environment variables.', {
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}

			await ctx.reply('🗑️ **Channel Cleanup Started**\n\nScanning and deleting messages from the channel...\n\n⚠️ This process will work backwards from recent messages.');

			let deletedCount = 0;
			let checkedCount = 0;
			let maxMessageId = 1000000; // Start from a very high number
			let consecutiveNotFound = 0;
			const maxConsecutiveNotFound = 100;

			logger.info({ targetChatId }, 'Starting comprehensive channel cleanup');

			// Find the range by trying to delete messages starting from a recent estimated range
			await ctx.reply('📍 **Starting deletion process...**');
			
			// Start from a reasonable range for most channels (recent messages)
			let startMessageId = 100000; // Start from a reasonably high number
			let foundAnyMessage = false;
			
			// First, find if there are any recent messages by testing a few high IDs
			for (let testId = startMessageId; testId > startMessageId - 1000; testId -= 100) {
				try {
					await ctx.telegram.deleteMessage(targetChatId, testId);
					deletedCount++;
					foundAnyMessage = true;
					logger.info({ messageId: testId }, 'Found and deleted message during range finding');
					break;
				} catch (err) {
					// Continue searching
				}
			}
			
			if (!foundAnyMessage) {
				// Try a broader range starting from 1
				startMessageId = 1;
				await ctx.reply('📍 **No recent messages found, scanning from beginning...**');
			}
			
			await ctx.reply(`📍 **Deleting messages starting from ID ${startMessageId}...**`);

			// Main deletion loop: work through the message range
			consecutiveNotFound = 0;
			checkedCount = 0;
			let currentMessageId = startMessageId;
			
			// If we found a message in the high range, work backwards; otherwise work forwards
			const increment = foundAnyMessage ? -1 : 1;
			const shouldContinue = foundAnyMessage ? 
				() => currentMessageId >= 1 && consecutiveNotFound < maxConsecutiveNotFound :
				() => currentMessageId <= maxMessageId && consecutiveNotFound < maxConsecutiveNotFound;
			
			while (shouldContinue()) {
				const messageId = currentMessageId;
				checkedCount++;
				
				try {
					await ctx.telegram.deleteMessage(targetChatId, messageId);
					deletedCount++;
					consecutiveNotFound = 0; // Reset counter when we find a message
					
					// Log progress
					if (deletedCount % 5 === 0) {
						logger.info({ deletedCount, messageId }, 'Channel cleanup progress');
					}
					
					// Rate limiting
					if (deletedCount % 10 === 0) {
						await new Promise(resolve => setTimeout(resolve, 500));
						
						// Progress update
						const progressMsg = `🗑️ **Cleanup Progress**\n\n` +
							`✅ Deleted: ${deletedCount} messages\n` +
							`📍 Current ID: ${messageId}\n` +
							`📊 Checked: ${checkedCount} IDs\n\n` +
							`Working backwards...`;
						
						try {
							await ctx.reply(progressMsg);
						} catch {} // Ignore update errors
					}
					
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					
					if (errorMsg.includes('message to delete not found') || 
						errorMsg.includes('Bad Request: message can\'t be deleted') ||
						errorMsg.includes('MESSAGE_ID_INVALID')) {
						consecutiveNotFound++;
					} else if (errorMsg.includes('Too Many Requests')) {
						// Rate limited - wait longer
						logger.warn({ messageId, errorMsg }, 'Rate limited, waiting...');
						await new Promise(resolve => setTimeout(resolve, 3000));
						currentMessageId -= increment; // Retry this message ID by undoing the increment that will happen at the end
						continue;
					} else {
						// Unexpected error
						logger.warn({ messageId, errorMsg }, 'Unexpected error during deletion');
					}
				}
				
				// Small delay between attempts
				await new Promise(resolve => setTimeout(resolve, 200));
				
				// Move to next message ID
				currentMessageId += increment;
			}

			const finalReport = `🗑️ **Channel Cleanup Complete!**\n\n` +
				`✅ **Successfully deleted:** ${deletedCount} messages\n` +
				`📊 **Total checked:** ${checkedCount} message IDs\n` +
				`📍 **Scan range:** ${startMessageId} ${foundAnyMessage ? '(backwards)' : '(forwards)'}\n\n` +
				`${deletedCount > 0 ? '🎉 Channel successfully cleaned!' : 'ℹ️ No deletable messages found.'}`;

			await ctx.reply(finalReport, {
				reply_markup: createMainMenu().reply_markup
			});

			logger.info({ 
				deletedCount, 
				checkedCount,
				startMessageId,
				foundAnyMessage,
				targetChatId 
			}, 'Channel cleanup completed');

		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			await ctx.reply(`❌ **Channel cleanup failed:** ${errorMsg}\n\nPossible issues:\n• Bot lacks admin permissions in target channel\n• Target channel ID is incorrect\n• Rate limiting by Telegram`, {
				reply_markup: createMainMenu().reply_markup
			});
			
			logger.error({ err, targetChatId: process.env.TELEGRAM_TARGET_CHAT_ID }, 'Channel cleanup failed');
		}
	});

	bot.command('deletelast', async (ctx) => {
		counters.commandsHandled.inc({ command: 'deletelast' });
		try {
			const args = ctx.message.text.split(' ').slice(1);
			const count = args.length > 0 ? parseInt(args[0] || '5') : 5;
			
			if (isNaN(count) || count < 1 || count > 50) {
				await ctx.reply('❌ **Invalid Count**\n\nPlease specify a number between 1 and 50.\n\nExample: `/deletelast 10`', {
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}

			const targetChatId = process.env.TELEGRAM_TARGET_CHAT_ID;
			
			if (!targetChatId) {
				await ctx.reply('❌ **No Target Channel Configured**\n\nPlease set TELEGRAM_TARGET_CHAT_ID in your environment variables.', {
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}

			await ctx.reply(`🗑️ **Deleting Last ${count} Messages**\n\nAttempting to delete the most recent ${count} messages from the channel...`);

			let deletedCount = 0;
			let checkedCount = 0;
			let currentMessageId = 999999; // Start from a high number and work backwards
			
			logger.info({ targetChatId, count }, 'Starting last messages deletion');

			// Work backwards from a high message ID to find and delete recent messages
			while (deletedCount < count && checkedCount < count * 10) { // Safety limit
				try {
					await ctx.telegram.deleteMessage(targetChatId, currentMessageId);
					deletedCount++;
					logger.info({ deletedCount, messageId: currentMessageId }, 'Deleted message');
					
					// Small delay between deletions
					await new Promise(resolve => setTimeout(resolve, 200));
					
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					if (errorMsg.includes('Too Many Requests')) {
						// Rate limited - wait longer
						await new Promise(resolve => setTimeout(resolve, 2000));
						continue; // Don't increment counters
					}
					// Message not found or can't be deleted - continue to next
				}
				
				currentMessageId--;
				checkedCount++;
			}

			const resultMsg = `🗑️ **Deletion Complete!**\n\n` +
				`✅ **Deleted:** ${deletedCount} messages\n` +
				`📍 **Checked:** ${checkedCount} message IDs\n\n` +
				`${deletedCount > 0 ? '🎉 Recent messages removed!' : 'ℹ️ No recent messages found to delete.'}`;

			await ctx.reply(resultMsg, {
				reply_markup: createMainMenu().reply_markup
			});

			logger.info({ deletedCount, checkedCount }, 'Last messages deletion completed');

		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			await ctx.reply(`❌ **Deletion failed:** ${errorMsg}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Automatic posting control commands
	bot.command('toggleposting', async (ctx) => {
		counters.commandsHandled.inc({ command: 'toggleposting' });
		try {
			const newState = toggleAutoPosting();
			const status = newState ? 'Enabled' : 'Disabled';
			const emoji = newState ? '✅' : '⏸️';
			
			await ctx.reply(`${emoji} **Automatic Posting ${status}**\n\nAutomatic posting to channel is now ${status.toLowerCase()}.`, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to toggle automatic posting.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.command('postingstatus', async (ctx) => {
		counters.commandsHandled.inc({ command: 'postingstatus' });
		try {
			const status = getSchedulerStatus();
			const autoPostingStatus = status.autoPostingEnabled ? '✅ Enabled' : '⏸️ Disabled';
			const schedulerStatus = status.isRunning ? '🟢 Running' : '🔴 Stopped';
			const processingStatus = status.isSchedulerRunning ? '⏳ Processing' : '💤 Idle';
			
			let report = `📊 **Scheduler Status Report**\n\n`;
			report += `🤖 **Automatic Posting:** ${autoPostingStatus}\n`;
			report += `⚙️ **Scheduler:** ${schedulerStatus}\n`;
			report += `🔄 **Current State:** ${processingStatus}\n\n`;
			
			report += `⚙️ **Configuration:**\n`;
			report += `• Target Category: ${status.configuration.targetCategory}\n`;
			report += `• Target Channel: ${status.configuration.targetChannel || 'Not configured'}\n`;
			report += `• Cron Pattern: ${status.configuration.cronPattern}\n\n`;
			
			report += `🎮 **Commands:**\n`;
			report += `• \`/toggleposting\` - Toggle automatic posting\n`;
			report += `• \`/postingstatus\` - Show this status\n\n`;
			report += `ℹ️ **Note:** Automatic posting is disabled by default for safety.\n`;
			report += `Use \`/toggleposting\` to enable when ready.`;
			
			await ctx.reply(report, {
				parse_mode: 'HTML',
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to get posting status.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});
}
