import { Telegraf } from 'telegraf';
import { createMainMenu, createAdminMenu, createPostingControlMenu, formatCommandsList } from '../utils/menu';
import { fetchAllArticles } from '../data-aggregator';
import { filterNewArticles } from '../storage';
import { filterArticlesByCategory, ContentCategory } from '../categorizer';
import { getTimeAgo, getSourceDomain } from '../utils/time';
import { sendTechNewsReport, sendFeedsReport, sendCategoriesReport } from './menu-actions';
import { enableAutoPosting, disableAutoPosting, toggleAutoPosting, getSchedulerStatus } from './scheduler';
import { handleRedditBrowseCommand } from '../reddit-browser';
import { counters } from '../metrics';

export function registerMenuHandlers(bot: Telegraf) {
	bot.hears('📱 Menu', async (ctx) => {
		await ctx.reply('📱 <b>Main Menu</b>', { 
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

	bot.hears('📰 Tech News', async (ctx) => {
		await sendTechNewsReport(ctx);
	});

	// Reddit Browser button handler
	bot.hears('📱 Browse Reddit', async (ctx) => {
		counters.commandsHandled.inc({ command: 'reddit_browse_button' });
		await handleRedditBrowseCommand(ctx);
	});

	bot.hears('📡 Feeds', async (ctx) => {
		await sendFeedsReport(ctx);
	});

	bot.hears('📊 Categories', async (ctx) => {
		await sendCategoriesReport(ctx);
	});

	// Admin tools handler
	bot.hears('🔧 Admin Tools', async (ctx) => {
		await ctx.reply('🔧 **Admin Tools Panel**\n\nSelect an admin function from the menu below:', {
			reply_markup: createAdminMenu().reply_markup
		});
	});

	bot.hears('📊 Posting Control', async (ctx) => {
		await ctx.reply('📊 **Posting Control Panel**\n\nManage automatic posting settings and monitor status:', {
			reply_markup: createPostingControlMenu().reply_markup
		});
	});

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

	// Scheduler test and channel test handlers
	bot.hears('⏱️ Scheduler Test', async (ctx) => {
		await ctx.reply('⏱️ **Scheduler Test**\n\nTesting article scheduling and filtering logic...');
		try {
			const articles = await fetchAllArticles(undefined, { maxAgeHours: 48 });
			const newOnes = await filterNewArticles(articles, { maxAgeHours: 48 });
			
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
