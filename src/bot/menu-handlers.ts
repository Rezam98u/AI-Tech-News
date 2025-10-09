/**
 * Bot menu handlers - extracted from main index.ts
 */
import { Telegraf } from 'telegraf';
import { createMainMenu, createAdminMenu, createPostingControlMenu, formatCommandsList } from '../utils/menu';
import { fetchAllArticles } from '../data-aggregator';
import { filterNewArticles } from '../storage';
import { getAnalysisMetrics } from '../ai-analysis/optimized';
import { categorizeAllArticles, filterArticlesByCategory, ContentCategory } from '../categorizer';
import { getTimeAgo, getSourceDomain } from '../utils/time';
import { getTrendingReposForTelegram } from '../github-api';
import { getPromptsForTelegramByCategory } from '../prompts';
import { createEnhancedPost, sendPostWithImage } from '../services/post-service';
import { enableAutoPosting, disableAutoPosting, toggleAutoPosting, getSchedulerStatus } from './scheduler';

/**
 * Register all menu handlers
 */
export function registerMenuHandlers(bot: Telegraf) {

	// Menu handling
	bot.hears('📱 Menu', async (ctx) => {
		await ctx.reply('📱 <b>Main Menu</b>', { 
			parse_mode: 'HTML',
			reply_markup: createMainMenu().reply_markup
		});
	});

	bot.hears('❓ Help', async (ctx) => {
		const helpMessage = `🤖 <b>AI Tech News Bot Help</b>

<b>Main Features:</b>
• 📰 Latest news from AI/tech sources
• 🤖 AI-powered content analysis
• 📊 Performance monitoring
• 🗑️ Channel management tools
• ⚙️ <b>Automatic posting control</b> (disabled by default)

<b>Quick Commands:</b>
• Use menu buttons below for easy navigation
• Type /latest for recent articles
• Type /analyze for AI analysis demo
• Type /performance for system stats
• Type /postingstatus for posting control

<b>Categories:</b>
• 🛠️ AI Tools &amp; Apps
• 📰 Tech News Flash  
• 💼 Business Use-Cases
• 🔍 Job Opportunities
• 💻 Developer Prompts

<b>Posting Control:</b>
• 📊 <b>Posting Status</b> - Check current state
• 🔄 <b>Toggle Auto Posting</b> - Quick enable/disable
• ⚙️ <b>Posting Control Panel</b> - Full control menu

<b>Admin Tools:</b>
• Cache management
• Channel cleanup
• Performance monitoring
• Debug utilities

<b>Safety Note:</b> Automatic posting is disabled by default for safety. Use the posting control menu to enable when ready.

For detailed commands list, tap <b>Commands List</b> below.`;

		await ctx.reply(helpMessage, {
			parse_mode: 'HTML',
			reply_markup: createMainMenu().reply_markup
		});
	});

	bot.hears('❓ Commands List', async (ctx) => {
		const commandsList = formatCommandsList();
		await ctx.reply(commandsList, {
			parse_mode: 'HTML',
			reply_markup: createMainMenu().reply_markup
		});
	});

	// Category handlers
	bot.hears('🛠️ AI Tools', async (ctx) => {
		try {
			const all = await fetchAllArticles();
			const toolArticles = filterArticlesByCategory(all, 'AI Tool');
			toolArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			let report = `🛠️ AI Tools & Apps (${toolArticles.length} found):\n\n`;
			
			const preview = toolArticles.slice(0, 5);
			preview.forEach((article) => {
				const domain = getSourceDomain(article.link);
				const timeAgo = getTimeAgo(article.pubDate);
				report += `🔧 ${article.title.substring(0, 60)}...\n`;
				report += `   🌐 ${domain} • ⏰ ${timeAgo}\n\n`;
			});
			
			if (toolArticles.length > 5) {
				report += `... and ${toolArticles.length - 5} more AI tools\n\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch AI tools.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.hears('📰 Tech News', async (ctx) => {
		try {
			const all = await fetchAllArticles();
			const newsArticles = filterArticlesByCategory(all, 'Tech News');
			newsArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			let report = `📰 Tech News Flash (${newsArticles.length} found):\n\n`;
			
			const preview = newsArticles.slice(0, 5);
			preview.forEach((article) => {
				const domain = getSourceDomain(article.link);
				const timeAgo = getTimeAgo(article.pubDate);
				report += `📰 ${article.title.substring(0, 60)}...\n`;
				report += `   🌐 ${domain} • ⏰ ${timeAgo}\n\n`;
			});
			
			if (newsArticles.length > 5) {
				report += `... and ${newsArticles.length - 5} more news articles\n\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch tech news.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.hears('💼 Business', async (ctx) => {
		try {
			const all = await fetchAllArticles();
			const businessArticles = filterArticlesByCategory(all, 'Business Use-Case');
			businessArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			let report = `💼 Business Use-Cases (${businessArticles.length} found):\n\n`;
			
			const preview = businessArticles.slice(0, 5);
			preview.forEach((article) => {
				const domain = getSourceDomain(article.link);
				const timeAgo = getTimeAgo(article.pubDate);
				report += `💼 ${article.title.substring(0, 60)}...\n`;
				report += `   🌐 ${domain} • ⏰ ${timeAgo}\n\n`;
			});
			
			if (businessArticles.length > 5) {
				report += `... and ${businessArticles.length - 5} more business articles\n\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch business articles.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.hears('🔍 Jobs', async (ctx) => {
		try {
			const all = await fetchAllArticles();
			const jobArticles = filterArticlesByCategory(all, 'Job Opportunity');
			jobArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			let report = `🔍 Job Opportunities (${jobArticles.length} found):\n\n`;
			
			const preview = jobArticles.slice(0, 5);
			preview.forEach((article) => {
				const domain = getSourceDomain(article.link);
				const timeAgo = getTimeAgo(article.pubDate);
				report += `🔍 ${article.title.substring(0, 60)}...\n`;
				report += `   🌐 ${domain} • ⏰ ${timeAgo}\n\n`;
			});
			
			if (jobArticles.length > 5) {
				report += `... and ${jobArticles.length - 5} more job opportunities\n\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch job opportunities.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.hears('💻 Developer Prompts', async (ctx) => {
		try {
			const all = await fetchAllArticles();
			const promptArticles = filterArticlesByCategory(all, 'Developer Prompts');
			promptArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			let report = `💻 Developer Prompts & GitHub Repos (${promptArticles.length} found):\n\n`;
			
			const preview = promptArticles.slice(0, 5);
			preview.forEach((article) => {
				const domain = getSourceDomain(article.link);
				const timeAgo = getTimeAgo(article.pubDate);
				const isGitHub = domain === 'github.com';
				const emoji = isGitHub ? '🐙' : '💻';
				report += `${emoji} ${article.title.substring(0, 60)}...\n`;
				report += `   🌐 ${domain} • ⏰ ${timeAgo}\n\n`;
			});
			
			if (promptArticles.length > 5) {
				report += `... and ${promptArticles.length - 5} more developer resources\n\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch developer prompts.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Test handlers
	bot.hears('🧪 Test Post', async (ctx) => {
		await ctx.reply('Creating enhanced test post...');
		try {
			const articles = await fetchAllArticles();
			if (articles.length === 0) {
				await ctx.reply('No articles available for testing.');
				return;
			}
			
		const testArticle = articles[0]!;
		const message = await createEnhancedPost(testArticle);
		if (message) {
				await sendPostWithImage(ctx.chat.id.toString(), message, testArticle.imageUrl);
			} else {
				await ctx.reply('❌ <b>Test Post Failed</b>\n\nUnable to analyze the test article. This may indicate an AI analysis issue.', {
					reply_markup: createMainMenu().reply_markup
				});
			}
		} catch (err) {
			await ctx.reply('Failed to create test post.');
		}
	});

	bot.hears('🇺🇸 Test English', async (ctx) => {
		await ctx.reply('🇺🇸 **Testing English Language Post**\n\nGenerating AI-enhanced post in English...');
		try {
			// Create a test English article
				const testEnglishArticle = {
					title: 'Meta Unveils Advanced AI Assistant for Businesses',
					link: 'https://example.com/meta-ai-business',
					contentSnippet: 'Meta has launched a new AI assistant specifically designed for business applications, featuring advanced natural language processing capabilities and integration with popular business tools. The assistant aims to improve productivity and streamline workflows.',
					pubDate: new Date().toISOString()
				};
			
			const message = await createEnhancedPost(testEnglishArticle);
			
			if (message) {
				await ctx.reply(message, {
					reply_markup: createMainMenu().reply_markup
				});
			} else {
				await ctx.reply('❌ <b>English Test Failed</b>\n\nUnable to analyze the English test article. This may indicate an AI analysis issue.', {
					reply_markup: createMainMenu().reply_markup
				});
			}
			
			await ctx.reply('✅ **English Test Complete!**\n\nThis demonstrates how the bot analyzes and formats content in English when specifically requested.', {
				reply_markup: createMainMenu().reply_markup
			});
			
		} catch (err) {
			await ctx.reply(`English test failed: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Additional utility handlers
	bot.hears('📡 Feeds', async (ctx) => {
		await ctx.reply('Fetching feeds...');
		try {
			const articles = await fetchAllArticles();
			const newOnes = await filterNewArticles(articles);
			
			let report = `📡 Feed Status Report:\n\n`;
			report += `📊 **Statistics:**\n`;
			report += `• Total articles: ${articles.length}\n`;
			report += `• New articles: ${newOnes.length}\n`;
			
			// Group by source
			const bySource: { [key: string]: typeof articles } = {};
			articles.forEach(article => {
				const domain = getSourceDomain(article.link);
				if (!bySource[domain]) bySource[domain] = [];
				bySource[domain]!.push(article);
			});
			
			report += `• Active sources: ${Object.keys(bySource).length}\n\n`;
			
			report += `📰 **Sources:**\n`;
			Object.entries(bySource).sort(([,a], [,b]) => b.length - a.length).forEach(([source, sourceArticles]) => {
				const newest = sourceArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate))[0];
				const timeAgo = newest ? getTimeAgo(newest.pubDate) : 'N/A';
				report += `• ${source}: ${sourceArticles.length} articles (latest: ${timeAgo})\n`;
			});
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch feeds.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.hears('📊 Categories', async (ctx) => {
		try {
			const articles = await fetchAllArticles();
			const categorized = categorizeAllArticles(articles);
			
			let report = `📊 Article Categories (${articles.length} total):\n\n`;
			
			Object.entries(categorized).forEach(([category, categoryArticles]) => {
				const categoryEmoji = {
					'AI Tool': '🛠️',
					'Tech News': '📰',
					'Business Use-Case': '💼',
					'Job Opportunity': '🔍',
					'Sponsored Deal': '💰',
					'Developer Prompts': '💻'
				}[category as ContentCategory] || '📋';
				
				const percentage = ((categoryArticles.length / articles.length) * 100).toFixed(1);
				report += `${categoryEmoji} **${category}**\n`;
				report += `   ${categoryArticles.length} articles (${percentage}%)\n\n`;
			});
			
			// Show category distribution
			const sortedCategories = Object.entries(categorized)
				.sort(([,a], [,b]) => b.length - a.length)
				.slice(0, 3);
			
			if (sortedCategories.length > 0) {
				report += `🏆 **Top Categories:**\n`;
				sortedCategories.forEach(([category, categoryArticles], index) => {
					const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
					report += `${medal} ${category}: ${categoryArticles.length} articles\n`;
				});
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to categorize articles.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Performance monitoring handlers
	bot.hears('⚡ Performance', async (ctx) => {
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

	bot.hears('🔍 Duplicates', async (ctx) => {
		await ctx.reply('🔍 Checking for duplicate articles...');
		try {
			const { loadPostedIds } = await import('../storage');
			const postedIds = await loadPostedIds();
			
			const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
			const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
			
			let report = '🔍 Duplicate Prevention Status:\n\n';
			report += `📊 Total Articles Found: ${articles.length}\n`;
			report += `🆕 New (Not Posted): ${newOnes.length}\n`;
			report += `✅ Already Posted: ${articles.length - newOnes.length}\n`;
			report += `💾 Tracked IDs: ${postedIds.size}\n\n`;
			
			report += '🎯 Next Posts Preview (Newest First):\n';
			const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
			const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
			// Sort by newest first
			categorizedArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			
			if (categorizedArticles.length > 0) {
				const preview = categorizedArticles.slice(0, 3);
				preview.forEach((article, index) => {
					const domain = getSourceDomain(article.link);
					const timeAgo = getTimeAgo(article.pubDate);
					report += `${index + 1}. ${domain} (${timeAgo}): ${article.title.substring(0, 40)}...\n`;
				});
			} else {
				report += 'No new articles in target category.\n';
			}
			
			report += `\n🏷️ Target Category: ${targetCategory}\n`;
			report += `📢 Target Channel: ${process.env.TELEGRAM_TARGET_CHAT_ID || 'Not set'}\n`;
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply(`Duplicate check failed: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Developer prompts and GitHub handlers
	bot.hears('💻 Dev Prompts DB', async (ctx) => {
		const message = getPromptsForTelegramByCategory('coding'); // Default to coding category
		await ctx.reply(message, {
			reply_markup: createMainMenu().reply_markup
		});
	});

	bot.hears('🐙 GitHub Trending', async (ctx) => {
		await ctx.reply('🔍 Fetching trending AI/ML repositories...');
		try {
			const message = await getTrendingReposForTelegram();
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply(`GitHub trending repos failed: ${err}`, {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	bot.hears('📋 Raw', async (ctx) => {
		try {
			const articles = await fetchAllArticles();
			let report = `📋 Raw Articles Feed (${articles.length} total):\n\n`;
			
			const latest = articles.slice(0, 10);
			latest.forEach((article, index) => {
				const timeAgo = getTimeAgo(article.pubDate);
				const domain = getSourceDomain(article.link);
				report += `${index + 1}. **${article.title}**\n`;
				report += `   🌐 ${domain} • ⏰ ${timeAgo}\n`;
				report += `   🔗 ${article.link}\n\n`;
			});
			
			if (articles.length > 10) {
				report += `... and ${articles.length - 10} more articles\n`;
			}
			
			await ctx.reply(report, {
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch raw articles.', {
				reply_markup: createMainMenu().reply_markup
			});
		}
	});

	// Admin tools handler
	bot.hears('🔧 Admin Tools', async (ctx) => {
		await ctx.reply('🔧 **Admin Tools Panel**\n\nSelect an admin function from the menu below:', {
			reply_markup: createAdminMenu().reply_markup
		});
	});

	// Posting control menu handler
	bot.hears('📊 Posting Control', async (ctx) => {
		await ctx.reply('📊 **Posting Control Panel**\n\nManage automatic posting settings and monitor status:', {
			reply_markup: createPostingControlMenu().reply_markup
		});
	});

	// Admin menu handlers (simplified versions - full implementations are in commands.ts)
	bot.hears('🔧 Debug Feeds', async (ctx) => {
		await ctx.reply('Testing each feed individually...');
		try {
			const { DEFAULT_FEEDS } = await import('../data-aggregator');
			
			let report = 'Feed Status Report:\n\n';
			for (const feedUrl of DEFAULT_FEEDS) {
				try {
					const domain = new URL(feedUrl).hostname.replace(/^www\./, '');
					const { fetchRssFeed } = await import('../data-aggregator');
					const articles = await fetchRssFeed(feedUrl);
					report += `✅ ${domain}: ${articles.length} articles\n`;
				} catch (err) {
					const domain = new URL(feedUrl).hostname.replace(/^www\./, '');
					report += `❌ ${domain}: Failed\n`;
				}
			}
			
			await ctx.reply(report, {
				reply_markup: createAdminMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Debug feeds failed.');
		}
	});

	// Cache management handlers
	bot.hears('🧹 Reset Cache', async (ctx) => {
		await ctx.reply('🧹 Resetting cache files...');
		try {
			const fs = require('fs');
			const path = require('path');
			
			const dataDir = path.join(process.cwd(), 'data');
			const analysisCacheFile = path.join(dataDir, 'analysis-cache.json');
			const postedFile = path.join(dataDir, 'posted.json');
			
			let resetCount = 0;
			let report = '🧹 **Cache Reset Report**\n\n';
			
			// Reset analysis cache
			if (fs.existsSync(analysisCacheFile)) {
				try {
					fs.unlinkSync(analysisCacheFile);
					report += '✅ Analysis cache cleared\n';
					resetCount++;
				} catch (err) {
					report += '❌ Failed to clear analysis cache\n';
				}
			} else {
				report += 'ℹ️ Analysis cache already empty\n';
			}
			
			// Reset posted articles
			if (fs.existsSync(postedFile)) {
				try {
					fs.unlinkSync(postedFile);
					report += '✅ Seen articles list cleared\n';
					resetCount++;
				} catch (err) {
					report += '❌ Failed to clear seen articles\n';
				}
			} else {
				report += 'ℹ️ Seen articles list already empty\n';
			}
			
			report += `\n🎉 **Reset Complete!** (${resetCount} files cleared)\n\n`;
			report += '**Effects:**\n';
			report += '• All articles will be treated as new\n';
			report += '• AI analysis cache starts fresh\n';
			report += '• Performance optimization resets\n';
			
			await ctx.reply(report, {
				reply_markup: createAdminMenu().reply_markup
			});
			
		} catch (err) {
			await ctx.reply(`Cache reset failed: ${err}`, {
				reply_markup: createAdminMenu().reply_markup
			});
		}
	});

	bot.hears('🗑️ Clear Seen Articles', async (ctx) => {
		await ctx.reply('🗑️ Clearing seen articles...');
		try {
			const fs = require('fs');
			const path = require('path');
			
			const postedFile = path.join(process.cwd(), 'data', 'posted.json');
			
			if (fs.existsSync(postedFile)) {
				fs.unlinkSync(postedFile);
				await ctx.reply('✅ **Seen Articles Cleared!**\n\nAll articles will now be treated as new and available for posting again.', {
					reply_markup: createAdminMenu().reply_markup
				});
			} else {
				await ctx.reply('ℹ️ **No Seen Articles Found**\n\nSeen articles list is already empty.', {
					reply_markup: createAdminMenu().reply_markup
				});
			}
			
		} catch (err) {
			await ctx.reply(`Failed to clear seen articles: ${err}`, {
				reply_markup: createAdminMenu().reply_markup
			});
		}
	});

	bot.hears('🗑️ Delete All Posts', async (ctx) => {
		await ctx.reply('⚠️ **DANGER ZONE**\n\nThis will delete ALL posts from your target channel.\n\nType `/deletechannel` to confirm or use the menu to go back.', {
			reply_markup: createAdminMenu().reply_markup
		});
	});

	bot.hears('🗑️ Delete Recent Posts', async (ctx) => {
		await ctx.reply('🗑️ **Delete Recent Posts**\n\nUse these commands to delete recent messages:\n\n• `/deletelast 5` - Delete last 5 posts\n• `/deletelast 10` - Delete last 10 posts\n• `/deletelast 25` - Delete last 25 posts\n\nOr type a custom number (1-50).', {
			reply_markup: createAdminMenu().reply_markup
		});
	});

	bot.hears('⚡ Performance Stats', async (ctx) => {
		// Redirect to main performance handler
		ctx.message.text = '⚡ Performance';
		return;
	});

	bot.hears('🔍 Duplicate Check', async (ctx) => {
		// Redirect to main duplicates handler  
		ctx.message.text = '🔍 Duplicates';
		return;
	});

	// Scheduler test and channel test handlers
	bot.hears('⏱️ Scheduler Test', async (ctx) => {
		await ctx.reply('⏱️ **Scheduler Test**\n\nTesting article scheduling and filtering logic...');
		try {
			const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
			const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
			
			let report = '⏱️ **Scheduler Test Results:**\n\n';
			report += `📊 Total articles: ${articles.length}\n`;
			report += `🆕 New articles: ${newOnes.length}\n`;
			
			const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
			const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
			report += `🎯 Target category (${targetCategory}): ${categorizedArticles.length}\n\n`;
			
			if (categorizedArticles.length > 0) {
				const nextArticle = categorizedArticles[0];
				report += `📰 **Next Article to Post:**\n`;
				report += `• Title: ${nextArticle!.title}\n`;
				report += `• Source: ${getSourceDomain(nextArticle!.link)}\n`;
				report += `• Published: ${getTimeAgo(nextArticle!.pubDate)}\n`;
			} else {
				report += '❌ No articles available for posting in target category.\n';
			}
			
			report += `\n⚙️ **Configuration:**\n`;
			report += `• Target category: ${targetCategory}\n`;
			report += `• Target channel: ${process.env.TELEGRAM_TARGET_CHAT_ID || 'Not set'}\n`;
			
			await ctx.reply(report, {
				reply_markup: createAdminMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply(`Scheduler test failed: ${err}`, {
				reply_markup: createAdminMenu().reply_markup
			});
		}
	});

	bot.hears('📢 Channel Test', async (ctx) => {
		await ctx.reply('📢 **Channel Test**\n\nTesting channel posting capabilities...');
		try {
			const targetChatId = process.env.TELEGRAM_TARGET_CHAT_ID;
			
			if (!targetChatId) {
				await ctx.reply('❌ **Channel Not Configured**\n\nPlease set TELEGRAM_TARGET_CHAT_ID in your environment variables.', {
					reply_markup: createAdminMenu().reply_markup
				});
				return;
			}
			
			// Test sending a message to the target channel
			const testMessage = '🧪 <b>Channel Test Message</b>\n\nThis is a test message from the AI Tech News Bot.\n\n✅ Channel posting is working correctly!';
			
			await ctx.telegram.sendMessage(targetChatId, testMessage, {
				parse_mode: 'HTML'
			});
			
			await ctx.reply(`✅ <b>Channel Test Successful!</b>\n\nTest message sent to channel: <code>${targetChatId}</code>\n\nChannel posting is working correctly.`, {
				parse_mode: 'HTML',
				reply_markup: createAdminMenu().reply_markup
			});
			
		} catch (err) {
			await ctx.reply(`❌ **Channel Test Failed**\n\nError: ${err}\n\nPlease check your channel configuration and bot permissions.`, {
				reply_markup: createAdminMenu().reply_markup
			});
		}
	});

	// Automatic posting control menu handlers
	bot.hears('✅ Enable Auto Posting', async (ctx) => {
		try {
			enableAutoPosting();
			await ctx.reply('✅ **Automatic Posting Enabled**\n\nThe bot will now automatically post new articles to the channel.\n\n*Note: Automatic posting is disabled by default for safety.*', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to enable automatic posting.', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		}
	});

	bot.hears('⏸️ Disable Auto Posting', async (ctx) => {
		try {
			disableAutoPosting();
			await ctx.reply('⏸️ **Automatic Posting Disabled**\n\nThe bot will no longer automatically post new articles to the channel.\n\n*This is the default safe state.*', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to disable automatic posting.', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		}
	});

	bot.hears('🔄 Toggle Auto Posting', async (ctx) => {
		try {
			const newState = toggleAutoPosting();
			const status = newState ? 'Enabled' : 'Disabled';
			const emoji = newState ? '✅' : '⏸️';
			
			await ctx.reply(`${emoji} **Automatic Posting ${status}**\n\nAutomatic posting to channel is now ${status.toLowerCase()}.`, {
				reply_markup: createPostingControlMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to toggle automatic posting.', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		}
	});

	bot.hears('📊 Posting Status', async (ctx) => {
		try {
			const status = getSchedulerStatus();
			const autoPostingStatus = status.autoPostingEnabled ? '✅ Enabled' : '⏸️ Disabled';
			const schedulerStatus = status.isRunning ? '🟢 Running' : '🔴 Stopped';
			const processingStatus = status.isSchedulerRunning ? '⏳ Processing' : '💤 Idle';
			const previewModeStatus = status.previewMode ? '👁️ Enabled (Review first)' : '🚀 Disabled (Direct post)';
			
			let report = `📊 <b>Scheduler Status Report</b>\n\n`;
			report += `🤖 <b>Automatic Posting:</b> ${autoPostingStatus}\n`;
			report += `👁️ <b>Preview Mode:</b> ${previewModeStatus}\n`;
			report += `⚙️ <b>Scheduler:</b> ${schedulerStatus}\n`;
			report += `🔄 <b>Current State:</b> ${processingStatus}\n`;
			report += `📋 <b>Pending Previews:</b> ${status.pendingPosts}\n\n`;
			
			report += `⚙️ <b>Configuration:</b>\n`;
			report += `• Target Category: ${status.configuration.targetCategory}\n`;
			report += `• Target Channel: ${status.configuration.targetChannel || 'Not configured'}\n`;
			report += `• Admin Chat: ${status.configuration.adminChatId || 'Same as target'}\n`;
			report += `• Cron Pattern: ${status.configuration.cronPattern}\n\n`;
			
			report += `🎮 <b>Commands:</b>\n`;
			report += `• <code>/toggleposting</code> - Toggle automatic posting\n`;
			report += `• <code>/togglepreview</code> - Toggle preview mode\n`;
			report += `• <code>/previews</code> - List pending previews\n`;
			report += `• <code>/postingstatus</code> - Show this status\n\n`;
			report += `ℹ️ <b>Note:</b> Preview mode shows posts for approval before sending to channel.`;
			
			await ctx.reply(report, {
				parse_mode: 'HTML',
				reply_markup: createPostingControlMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to get posting status.', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		}
	});

	bot.hears('📋 List Previews', async (ctx) => {
		try {
			const { listPendingPosts } = await import('./scheduler');
			const result = await listPendingPosts();
			await ctx.reply(result, {
				parse_mode: 'HTML',
				reply_markup: createPostingControlMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to list pending previews.', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		}
	});

	bot.hears('👁️ Toggle Preview Mode', async (ctx) => {
		try {
			const { isPreviewMode, setPreviewMode } = await import('./scheduler');
			const currentMode = isPreviewMode();
			setPreviewMode(!currentMode);
			const newMode = !currentMode;
			
			const status = newMode ? 'Enabled' : 'Disabled';
			const emoji = newMode ? '👁️' : '🚀';
			const explanation = newMode ? 
				'Posts will now be sent to you for preview and confirmation before posting to channel.' :
				'Posts will now be sent directly to channel without preview.';
			
			await ctx.reply(`${emoji} <b>Preview Mode ${status}</b>\n\n${explanation}`, {
				parse_mode: 'HTML',
				reply_markup: createPostingControlMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to toggle preview mode.', {
				reply_markup: createPostingControlMenu().reply_markup
			});
		}
	});

	bot.hears('🧹 Clean Up Previews', async (ctx) => {
		try {
			const { cleanupOldPendingPosts } = await import('./scheduler');
			const cleanedCount = cleanupOldPendingPosts();
			
			if (cleanedCount > 0) {
				await ctx.reply(`🧹 <b>Cleaned Up ${cleanedCount} Expired Preview${cleanedCount > 1 ? 's' : ''}</b>\n\nExpired previews (older than 24 hours) have been removed.`, {
					parse_mode: 'HTML',
					reply_markup: createAdminMenu().reply_markup
				});
			} else {
				await ctx.reply('✅ <b>No Expired Previews Found</b>\n\nAll pending previews are recent.', {
					parse_mode: 'HTML',
					reply_markup: createAdminMenu().reply_markup
				});
			}
		} catch (err) {
			await ctx.reply('Failed to clean up previews.', {
				reply_markup: createAdminMenu().reply_markup
			});
		}
	});

	bot.hears('🗑️ Clear Chat History', async (ctx) => {
		await ctx.reply('⚠️ <b>Clear Chat History</b>\n\nThis will delete all messages in this chat with the bot.\n\nTo confirm, type <code>/clearchat</code>', {
			parse_mode: 'HTML',
			reply_markup: createAdminMenu().reply_markup
		});
	});
}
