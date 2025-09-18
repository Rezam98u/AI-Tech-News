/**
 * Bot command handlers - extracted from main index.ts
 */
import { Telegraf } from 'telegraf';
import { logger } from '../logger';
import { counters } from '../metrics';
import { createMainMenu } from '../utils/menu';
import { fetchAllArticles, getRecentArticles } from '../data-aggregator';
import { getPostReadyAnalysis, getAnalysisMetrics } from '../ai-analysis/optimized';
import { categorizeAllArticles, ContentCategory } from '../categorizer';
import { getTimeAgo, getSourceDomain } from '../utils/time';

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
	
	bot.command('latest', async (ctx) => {
		counters.commandsHandled.inc({ command: 'latest' });
		try {
			const all = await fetchAllArticles();
			const latestCount = Math.min(10, all.length);
			let report = `📰 Latest ${latestCount} AI Tech News:\n\n`;
			
			const latest = all.slice(0, latestCount);
		for (const article of latest) {
			const timeAgo = getTimeAgo(article.pubDate);
			const domain = getSourceDomain(article.link);
			report += `📌 ${article.title}\n`;
			report += `🌐 ${domain} • ⏰ ${timeAgo}\n\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch latest articles.', {
				reply_markup: createMainMenu().reply_markup
			});
			logger.error({ err }, 'latest command failed');
		}
	});

	bot.command('today', async (ctx) => {
		counters.commandsHandled.inc({ command: 'today' });
		try {
			const all = await getRecentArticles(24);
			let report = `📅 Today's AI Tech News (${all.length} articles):\n\n`;
			
			// Group by source
			const bySource: { [key: string]: typeof all } = {};
			all.forEach(article => {
				const domain = getSourceDomain(article.link);
				if (!bySource[domain]) bySource[domain] = [];
				bySource[domain]!.push(article);
			});
			
			Object.entries(bySource).forEach(([source, articles]) => {
				report += `🔸 **${source}** (${articles.length})\n`;
			articles.slice(0, 3).forEach(article => {
				report += `  • ${article.title.substring(0, 80)}...\n`;
				});
				report += '\n';
			});
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch today\'s articles.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.command('week', async (ctx) => {
		counters.commandsHandled.inc({ command: 'week' });
		try {
			const all = await getRecentArticles(24 * 7);
			let report = `📊 This Week's AI Tech News Summary (${all.length} articles):\n\n`;
			
			// Categorize articles
			const categorized = categorizeAllArticles(all);
			
			Object.entries(categorized).forEach(([category, articles]) => {
				if (articles.length > 0) {
					const categoryEmoji = {
						'AI Tool': '🛠️',
						'Tech News': '📰',
						'Business Use-Case': '💼',
						'Job Opportunity': '🔍',
						'Sponsored Deal': '💰',
						'Developer Prompts': '💻'
					}[category as ContentCategory] || '📋';
					
					report += `${categoryEmoji} **${category}** (${articles.length})\n`;
					const preview = articles.slice(0, 3);
					preview.forEach((article) => {
						const domain = getSourceDomain(article.link);
						report += `  • ${article.title.substring(0, 60)}... (${domain})\n`;
					});
					report += '\n';
				}
			});
			
			report += `📈 **Weekly Stats:**\n`;
			report += `• Total articles: ${all.length}\n`;
			const sources = [...new Set(all.map(a => getSourceDomain(a.link)))];
			report += `• Sources: ${sources.length}\n`;
			const top3Sources = Object.entries(
				all.reduce((acc, a) => {
					const source = getSourceDomain(a.link);
					acc[source] = (acc[source] || 0) + 1;
					return acc;
				}, {} as Record<string, number>)
			).sort(([,a], [,b]) => b - a).slice(0, 3);
			
			if (top3Sources.length > 0) {
				report += `• Top sources: ${top3Sources.map(([source, count]) => `${source} (${count})`).join(', ')}\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch weekly articles.', {
				reply_markup: createMainMenu().reply_markup
			});
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

			await ctx.reply('🗑️ **Channel Cleanup Started**\n\nDeleting all messages from the target channel...\n\n⚠️ This may take a few minutes for channels with many messages.');

			let deletedCount = 0;
			let errorCount = 0;
			let currentMessageId = 1;
			let consecutiveErrors = 0;
			const maxConsecutiveErrors = 50; // Stop if too many consecutive errors

			logger.info({ targetChatId }, 'Starting channel cleanup');

			// Delete messages in batches to avoid rate limits
			while (consecutiveErrors < maxConsecutiveErrors) {
				try {
					// Try to delete the current message ID
					await ctx.telegram.deleteMessage(targetChatId, currentMessageId);
					deletedCount++;
					consecutiveErrors = 0; // Reset error counter
					
					// Log progress every 10 deletions
					if (deletedCount % 10 === 0) {
						logger.info({ deletedCount, currentMessageId }, 'Channel cleanup progress');
					}
					
					// Small delay to avoid hitting rate limits too hard
					if (deletedCount % 5 === 0) {
						await new Promise(resolve => setTimeout(resolve, 100));
					}
					
				} catch (err) {
					errorCount++;
					consecutiveErrors++;
					
					// Common errors that are expected
					const errorMsg = err instanceof Error ? err.message : String(err);
					if (errorMsg.includes('message to delete not found') || 
						errorMsg.includes('Bad Request: message can\'t be deleted') ||
						errorMsg.includes('MESSAGE_ID_INVALID')) {
						// These are expected - message doesn't exist or can't be deleted
					} else if (errorMsg.includes('Too Many Requests')) {
						// Rate limited - wait longer
						logger.warn({ currentMessageId, errorMsg }, 'Rate limited, waiting...');
						await new Promise(resolve => setTimeout(resolve, 2000));
						consecutiveErrors--; // Don't count rate limits as consecutive errors
					} else {
						// Unexpected error
						logger.warn({ currentMessageId, errorMsg }, 'Unexpected error during deletion');
					}
				}
				
				currentMessageId++;
				
				// Update progress every 50 attempts
				if (currentMessageId % 50 === 0) {
					const progressMsg = `🗑️ **Cleanup Progress**\n\n` +
						`✅ Deleted: ${deletedCount} messages\n` +
						`📍 Checking message ID: ${currentMessageId}\n` +
						`❌ Errors: ${errorCount}\n\n` +
						`Still working...`;
					
					try {
						await ctx.reply(progressMsg);
					} catch (updateErr) {
						// Ignore update errors
					}
				}
			}

			const finalReport = `🗑️ **Channel Cleanup Complete!**\n\n` +
				`✅ **Deleted:** ${deletedCount} messages\n` +
				`📍 **Checked up to:** Message ID ${currentMessageId}\n` +
				`❌ **Errors:** ${errorCount}\n\n` +
				`${deletedCount > 0 ? '🎉 Channel successfully cleaned!' : 'ℹ️ No messages found to delete.'}`;

			await ctx.reply(finalReport, {
				reply_markup: createMainMenu().reply_markup
			});

			logger.info({ 
				deletedCount, 
				errorCount, 
				finalMessageId: currentMessageId,
				targetChatId 
			}, 'Channel cleanup completed');

		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			await ctx.reply(`❌ **Channel cleanup failed:** ${errorMsg}`, {
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
}
