import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { fetchAllArticles, getRecentArticles } from './data-aggregator';
import { filterNewArticles } from './storage';
import { analyzeArticle } from './ai-analysis';
import { getPostReadyAnalysis, getAnalysisMetrics } from './ai-analysis/optimized';
import { logger } from './logger';
import { counters, startMetricsServer } from './metrics';
import { getTimeAgo, getSourceDomain } from './utils/time';
import { createMainMenu, createCategoryMenu, createToolsMenu, createAdminMenu, createHelpMenu, formatCommandsList, getCommandByDescription } from './utils/menu';
import cron from 'node-cron';
import { markArticlesPosted } from './storage';
import { categorizeArticle, filterArticlesByCategory, categorizeAllArticles, ContentCategory } from './categorizer';
import { getTrendingReposForTelegram } from './github-api';
import { DEVELOPER_PROMPTS, getPromptsByCategory, searchPrompts, getRandomPrompt, formatPromptForTelegram, getPromptsForTelegramByCategory } from './prompts';

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
	logger.error('Missing BOT_TOKEN in environment');
	process.exit(1);
}

const bot = new Telegraf(botToken);
startMetricsServer();

// Global update counter
bot.use(async (ctx, next) => {
	counters.messagesReceived.inc();
	return next();
});

bot.start(async (ctx) => {
	counters.commandsHandled.inc({ command: 'start' });
	await ctx.reply('🚀 *AI Pipeline Bot is online!*\n\nWelcome to your AI Tech News hub. Use the menu below to navigate:', { 
		parse_mode: 'Markdown',
		reply_markup: createMainMenu().reply_markup
	});
	
	try {
		// Get all articles without age restriction to see the very latest
		const articles = await fetchAllArticles();
		
		// Sort by publication date (newest first) - this ensures we get the absolute latest
		articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
		
		// Show the most recent article with enhanced format
		const latestArticle = articles[0];
		if (latestArticle) {
			const message = await createEnhancedPost(latestArticle);
			await sendPostWithImage(ctx.chat.id.toString(), message, latestArticle.imageUrl);
		} else {
			await ctx.reply('No articles found right now.', { 
				link_preview_options: { is_disabled: true } 
			});
		}
		
		logger.info({ 
			totalArticles: articles.length,
			shown: latestArticle ? 1 : 0,
			newestDate: articles[0]?.pubDate,
			hasImage: latestArticle?.imageUrl ? true : false
		}, 'start command showed latest article');
		
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'start' });
		await ctx.reply('Failed to fetch articles.');
		logger.error({ err }, 'start command failed');
	}
});

bot.command('feeds', async (ctx) => {
	counters.commandsHandled.inc({ command: 'feeds' });
	try {
		await ctx.reply('Fetching feeds...');
		const articles = await fetchAllArticles();
		const counts = new Map<string, number>();
		for (const a of articles) {
			try {
				const url = new URL(a.link);
				const host = url.hostname.replace(/^www\./, '');
				counts.set(host, (counts.get(host) || 0) + 1);
			} catch {}
		}
		const summary = Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([host, n]) => `${host}: ${n}`)
			.join('\n');
		await ctx.reply(summary || 'No articles found.');
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'feeds' });
		await ctx.reply('Failed to fetch feeds.');
		logger.error({ err }, 'feeds command failed');
	}
});

bot.command('debug', async (ctx) => {
	counters.commandsHandled.inc({ command: 'debug' });
	try {
		await ctx.reply('Testing each feed individually...');
		const { DEFAULT_FEEDS } = await import('./data-aggregator');
		
		let report = 'Feed Status Report:\n\n';
		for (const feedUrl of DEFAULT_FEEDS) {
			try {
				const domain = new URL(feedUrl).hostname.replace(/^www\./, '');
				const { fetchRssFeed } = await import('./data-aggregator');
				const articles = await fetchRssFeed(feedUrl);
				report += `✅ ${domain}: ${articles.length} articles\n`;
			} catch (err: any) {
				const domain = new URL(feedUrl).hostname.replace(/^www\./, '');
				report += `❌ ${domain}: ${err.message || 'Error'}\n`;
			}
		}
		
		await ctx.reply(report, { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'debug' });
		await ctx.reply('Debug command failed.');
		logger.error({ err }, 'debug command failed');
	}
});

bot.command('categories', async (ctx) => {
	counters.commandsHandled.inc({ command: 'categories' });
	try {
		await ctx.reply('Categorizing recent articles...');
		const articles = await fetchAllArticles();
		const categorized = categorizeAllArticles(articles);
		
		// Show source breakdown
		const sources = new Map<string, number>();
		for (const article of articles) {
			const domain = getSourceDomain(article.link);
			sources.set(domain, (sources.get(domain) || 0) + 1);
		}
		
		let report = '📊 Article Categories:\n\n';
		report += `🛠️ AI Tools: ${categorized['AI Tool'].length}\n`;
		report += `📰 Tech News: ${categorized['Tech News'].length}\n`;
		report += `💼 Business Use-Cases: ${categorized['Business Use-Case'].length}\n`;
		report += `🔍 Job Opportunities: ${categorized['Job Opportunity'].length}\n`;
		report += `💰 Sponsored Deals: ${categorized['Sponsored Deal'].length}\n`;
		report += `💻 Developer Prompts: ${categorized['Developer Prompts'].length}\n`;
		
		const totalCategorized = Object.values(categorized).flat().length;
		const uncategorized = articles.length - totalCategorized;
		report += `❓ Uncategorized: ${uncategorized}\n`;
		report += `\nTotal: ${articles.length} articles\n\n`;
		
		report += '📊 Sources:\n';
		Array.from(sources.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.forEach(([domain, count]) => {
				report += `• ${domain}: ${count}\n`;
			});
		
		await ctx.reply(report);
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'categories' });
		await ctx.reply('Categories command failed.');
		logger.error({ err }, 'categories command failed');
	}
});

bot.command('prompts', async (ctx) => {
	counters.commandsHandled.inc({ command: 'prompts' });
	try {
		const articles = await fetchAllArticles();
		const promptArticles = filterArticlesByCategory(articles, 'Developer Prompts');
		
		if (promptArticles.length === 0) {
			await ctx.reply('No developer prompts or GitHub repositories found.', {
				reply_markup: createMainMenu().reply_markup
			});
			return;
		}
		
		// Sort by newest first
		promptArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
		
		let report = `💻 Developer Prompts & GitHub Repos (${promptArticles.length} found):\n\n`;
		
		const preview = promptArticles.slice(0, 5);
		preview.forEach((article, i) => {
			const domain = getSourceDomain(article.link);
			const timeAgo = getTimeAgo(article.pubDate);
			const isGitHub = domain === 'github.com';
			const emoji = isGitHub ? '🐙' : '💻';
			report += `${emoji} ${article.title.substring(0, 60)}...\n`;
			report += `   🔗 ${domain} • ⏰ ${timeAgo}\n\n`;
		});
		
		if (promptArticles.length > 5) {
			report += `... and ${promptArticles.length - 5} more`;
		}
		
		await ctx.reply(report, {
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply(`Prompts command failed: ${err}`, {
			reply_markup: createMainMenu().reply_markup
		});
	}
});

bot.command('aitools', async (ctx) => {
	counters.commandsHandled.inc({ command: 'aitools' });
	try {
		const articles = await fetchAllArticles();
		const aiTools = filterArticlesByCategory(articles, 'AI Tool');
		if (aiTools.length === 0) return void (await ctx.reply('No AI tool articles found.'));
		
		const formatted = aiTools.slice(0, 10).map(formatArticle).join('\n');
		await ctx.reply(`🛠️ AI Tools & Apps:\n\n${formatted}`, { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'aitools' });
		await ctx.reply('AI tools command failed.');
		logger.error({ err }, 'aitools command failed');
	}
});

bot.command('technews', async (ctx) => {
	counters.commandsHandled.inc({ command: 'technews' });
	try {
		const articles = await fetchAllArticles();
		const techNews = filterArticlesByCategory(articles, 'Tech News');
		if (techNews.length === 0) return void (await ctx.reply('No tech news articles found.'));
		
		const formatted = techNews.slice(0, 10).map(formatArticle).join('\n');
		await ctx.reply(`📰 Tech News Flash:\n\n${formatted}`, { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'technews' });
		await ctx.reply('Tech news command failed.');
		logger.error({ err }, 'technews command failed');
	}
});

bot.command('business', async (ctx) => {
	counters.commandsHandled.inc({ command: 'business' });
	try {
		const articles = await fetchAllArticles();
		const businessCases = filterArticlesByCategory(articles, 'Business Use-Case');
		if (businessCases.length === 0) return void (await ctx.reply('No business use-case articles found.'));
		
		const formatted = businessCases.slice(0, 10).map(formatArticle).join('\n');
		await ctx.reply(`💼 Business Use-Cases:\n\n${formatted}`, { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'business' });
		await ctx.reply('Business command failed.');
		logger.error({ err }, 'business command failed');
	}
});

bot.command('jobs', async (ctx) => {
	counters.commandsHandled.inc({ command: 'jobs' });
	try {
		// Get articles from last 45 days for job relevance
		const articles = await fetchAllArticles(undefined, { maxAgeHours: 45 * 24 });
		const jobOpportunities = filterArticlesByCategory(articles, 'Job Opportunity');
		
		if (jobOpportunities.length === 0) {
			return void (await ctx.reply('No job opportunities found in the last 45 days.'));
		}
		
		const formatted = jobOpportunities.slice(0, 15).map(formatArticle).join('\n');
		const header = `🔍 Job Opportunities (Last 45 Days):\n\n`;
		await ctx.reply(`${header}${formatted}`, { link_preview_options: { is_disabled: true } });
		
		logger.info({ 
			totalArticles: articles.length,
			jobsFound: jobOpportunities.length,
			shown: Math.min(15, jobOpportunities.length),
			timeFilter: '45 days'
		}, 'jobs command showed recent job opportunities');
		
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'jobs' });
		await ctx.reply('Jobs command failed.');
		logger.error({ err }, 'jobs command failed');
	}
});

bot.command('raw', async (ctx) => {
	counters.commandsHandled.inc({ command: 'raw' });
	try {
		const articles = await fetchAllArticles();
		
		// Show newest 5 articles from each major source
		const sources = ['techcrunch.com', 'openai.com', 'technologyreview.com', 'theverge.com', 'huggingface.co', 'blog.google'];
		let report = '📰 Raw Articles by Source:\n\n';
		
		for (const source of sources) {
			const sourceArticles = articles.filter(a => getSourceDomain(a.link) === source).slice(0, 3);
			if (sourceArticles.length > 0) {
				report += `🔗 ${source} (${sourceArticles.length}):\n`;
				sourceArticles.forEach(a => {
					report += `• ${a.title.substring(0, 60)}...\n`;
				});
				report += '\n';
			}
		}
		
		await ctx.reply(report, { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'raw' });
		await ctx.reply('Raw command failed.');
		logger.error({ err }, 'raw command failed');
	}
});

bot.command('schedulertest', async (ctx) => {
	counters.commandsHandled.inc({ command: 'schedulertest' });
	try {
		await ctx.reply('Testing scheduler logic...');
		
		// Simulate scheduler logic
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
		
		const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
		const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
		const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
		
		let report = `🧪 Scheduler Test:\n\n`;
		report += `📁 Target Channel: ${targetChat}\n`;
		report += `🏷️ Target Category: ${targetCategory}\n`;
		report += `📊 Total Articles: ${articles.length}\n`;
		report += `🆕 New Articles: ${newOnes.length}\n`;
		report += `✅ Categorized: ${categorizedArticles.length}\n\n`;
		
		if (categorizedArticles.length > 0) {
			const a = categorizedArticles[0]!;
			report += `📰 Next to post:\n${a.title}\n${a.link}`;
		} else {
			report += `❌ No articles to post`;
		}
		
		await ctx.reply(report, { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'schedulertest' });
		await ctx.reply('Scheduler test failed.');
		logger.error({ err }, 'schedulertest command failed');
	}
});

bot.command('channeltest', async (ctx) => {
	counters.commandsHandled.inc({ command: 'channeltest' });
	try {
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			return void (await ctx.reply('❌ TELEGRAM_TARGET_CHAT_ID not set in environment'));
		}
		
		await ctx.reply(`🧪 Testing post to channel: ${targetChat}`);
		
		// Try to post a test message to the channel
		const testMessage = `🤖 Test message from AI Pipeline Bot\n⏰ ${new Date().toISOString()}\n\nIf you see this, auto-posting is working!`;
		
		await bot.telegram.sendMessage(targetChat, testMessage);
		await ctx.reply(`✅ Successfully posted to ${targetChat}!`);
		
		logger.info({ targetChat }, 'manual channel test successful');
		
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'channeltest' });
		await ctx.reply(`❌ Failed to post to channel: ${err}`);
		logger.error({ err, targetChat: process.env.TELEGRAM_TARGET_CHAT_ID }, 'channel test failed');
	}
});

function formatArticle(a: { title: string; link: string; pubDate: string; imageUrl?: string }): string {
	const domain = getSourceDomain(a.link);
	return `${domain}\n📰 ${a.title}\n🔗 ${a.link}\n---`;
}

async function sendPostWithImage(chatId: string, message: string, imageUrl?: string): Promise<void> {
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
				
				await bot.telegram.sendPhoto(chatId, imageUrl, {
					caption: shortCaption,
					parse_mode: 'Markdown',
				});
				
				// Send full message as separate text
				await bot.telegram.sendMessage(chatId, message, { 
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
				await bot.telegram.sendPhoto(chatId, imageUrl, photoOptions);
				logger.info('Photo sent successfully via direct URL');
			} catch (directError) {
				logger.warn({ error: String(directError) }, 'Direct URL failed, trying with Input object');
				
				// Method 2: Using Input object (sometimes works better)
				await bot.telegram.sendPhoto(chatId, { url: imageUrl }, photoOptions);
				logger.info('Photo sent successfully via Input object');
			}
		} catch (err) {
			// If image fails, fall back to text only
			const errorMsg = err instanceof Error ? err.message : String(err);
			logger.warn({ 
				error: errorMsg, 
				imageUrl: imageUrl?.substring(0, 100) + '...' 
			}, 'Failed to send image, falling back to text');
			
			await bot.telegram.sendMessage(chatId, message, { 
				link_preview_options: { is_disabled: true },
				parse_mode: 'Markdown'
			});
		}
	} else {
		// No image, send text only
		logger.info('No image URL provided, sending text only');
		await bot.telegram.sendMessage(chatId, message, { 
			link_preview_options: { is_disabled: true },
			parse_mode: 'Markdown'
		});
	}
}

function shortenLink(url: string, maxLength: number = 60): string {
	try {
		const urlObj = new URL(url);
		const domain = urlObj.hostname.replace(/^www\./, '');
		const path = urlObj.pathname + urlObj.search;
		
		// If the full URL is short enough, return it
		if (url.length <= maxLength) {
			return url;
		}
		
		// Try domain + shortened path
		const shortPath = path.length > 30 ? path.substring(0, 27) + '...' : path;
		const shortUrl = `https://${domain}${shortPath}`;
		
		// If still too long, just show domain
		if (shortUrl.length > maxLength) {
			return `https://${domain}/...`;
		}
		
		return shortUrl;
	} catch {
		// If URL parsing fails, just truncate
		return url.length > maxLength ? url.substring(0, maxLength - 3) + '...' : url;
	}
}

async function createEnhancedPost(article: any): Promise<string> {
	try {
		// Use optimized AI analysis with caching
		logger.info({ title: article.title }, 'Generating optimized AI analysis for post');
		const analysis = await getPostReadyAnalysis(article);
		logger.info({ 
			title: article.title, 
			hasDescription: !!analysis.description,
			hashtagCount: analysis.hashtags.length 
		}, 'Optimized AI analysis completed');
		
		// Build the enhanced post with tldr, bullets, business_implication, and more
		const hashtags = analysis.hashtags.length > 0 
			? '\n\n' + analysis.hashtags.map(tag => `#${tag}`).join(' ')
			: '';
		
		const shortLink = shortenLink(article.link);
		const timeAgo = getTimeAgo(article.pubDate);
		
		// Build bullets section
		const bulletsSection = analysis.bullets && analysis.bullets.length > 0
			? '\n\n🔸 ' + analysis.bullets.join('\n🔸 ')
			: '';
		
		// Build business implication section (optional)
		const businessSection = analysis.business_implication && analysis.business_implication.trim()
			? `\n\n💼 **Business Impact:** ${analysis.business_implication}`
			: '';
		
		const enhancedPost = `💡 ${analysis.tldr}${bulletsSection}${businessSection}

${analysis.description}${hashtags}

⏰ ${timeAgo}
🔗 ${shortLink}`;

		logger.info({ title: article.title, postLength: enhancedPost.length }, 'Enhanced post created successfully');
		return enhancedPost;
		
	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err), 
			article: article.title
		}, 'Failed to create enhanced post, using fallback');
		
		// Fallback to simple format if AI analysis fails
		const shortLink = shortenLink(article.link);
		const timeAgo = getTimeAgo(article.pubDate);
		return `💡 Latest development in AI/tech space

🔸 Important news for the industry
🔸 Could impact businesses and professionals
🔸 Worth monitoring for updates

⏰ ${timeAgo}
🔗 ${shortLink}`;
	}
}

bot.command('latest', async (ctx) => {
	counters.commandsHandled.inc({ command: 'latest' });
	try {
		const all = await fetchAllArticles();
		// Ensure sorted by newest first from ALL sources
		all.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
		const top = all.slice(0, 10);
		if (top.length === 0) return void (await ctx.reply('No recent articles available.'));
		
		const formatted = top.map(formatArticle).join('\n');
		await ctx.reply(`📰 Latest Articles (All Sources):\n\n${formatted}`, { 
			link_preview_options: { is_disabled: true } 
		});
		
		logger.info({ 
			totalArticles: all.length,
			shown: top.length,
			sources: [...new Set(top.map(a => getSourceDomain(a.link)))]
		}, 'latest command showed articles from all sources');
		
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'latest' });
		logger.error({ err }, 'latest command failed');
		await ctx.reply('Failed to fetch latest articles.');
	}
});

bot.command('today', async (ctx) => {
	counters.commandsHandled.inc({ command: 'today' });
	try {
		const all = await getRecentArticles(24);
		if (all.length === 0) return void (await ctx.reply('No articles from the last 24 hours.'));
		await ctx.reply(all.slice(0, 20).map(formatArticle).join('\n'), { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'today' });
		logger.error({ err }, 'today command failed');
		await ctx.reply('Failed to fetch today\'s articles.');
	}
});

bot.command('week', async (ctx) => {
	counters.commandsHandled.inc({ command: 'week' });
	try {
		const all = await getRecentArticles(24 * 7);
		if (all.length === 0) return void (await ctx.reply('No articles from the last 7 days.'));
		await ctx.reply(all.slice(0, 20).map(formatArticle).join('\n'), { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'week' });
		logger.error({ err }, 'week command failed');
		await ctx.reply('Failed to fetch this week\'s articles.');
	}
});

bot.command('recent', async (ctx) => {
	counters.commandsHandled.inc({ command: 'recent' });
	try {
		const text = ctx.message && 'text' in ctx.message ? (ctx.message.text as string) : '';
		const match = text.match(/^\/recent\s+(\d{1,2})/);
		let n = 10;
		if (match && typeof match[1] === 'string') {
			const parsed = parseInt(match[1], 10);
			if (!Number.isNaN(parsed) && parsed > 0) n = parsed;
		}
		if (isNaN(n) || n <= 0) n = 10;
		n = Math.min(20, n);
		const all = await fetchAllArticles();
		if (all.length === 0) return void (await ctx.reply('No recent articles available.'));
		await ctx.reply(all.slice(0, n).map(formatArticle).join('\n'), { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'recent' });
		logger.error({ err }, 'recent command failed');
		await ctx.reply('Failed to fetch recent articles.');
	}
});

bot.command('analyze', async (ctx) => {
	counters.commandsHandled.inc({ command: 'analyze' });
	try {
		await ctx.reply('Analyzing the latest unseen article...');
		const articles = await fetchAllArticles();
		const newOnes = await filterNewArticles(articles);
		if (newOnes.length === 0) {
			await ctx.reply('No new articles to analyze.');
			return;
		}
		const first = newOnes[0]!;
		const result = await analyzeArticle(first);
		const message = `
📰 ${first.title}
${first.link}

TL;DR: ${result.tldr}

Key takeaways:
• ${result.bullets[0] ?? ''}
• ${result.bullets[1] ?? ''}
• ${result.bullets[2] ?? ''}

Business implication:
${result.business_implication}

Audience: ${result.target_audience}

Description: ${result.description}

Hashtags: ${result.hashtags.map(tag => `#${tag}`).join(' ')}
`.trim();
		await ctx.reply(message, { link_preview_options: { is_disabled: true } });
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

// Menu handling
bot.hears('📱 Menu', async (ctx) => {
	await ctx.reply('📱 *Main Menu*', { 
		parse_mode: 'Markdown',
		reply_markup: createMainMenu().reply_markup
	});
});

bot.hears('🏠 Main Menu', async (ctx) => {
	await ctx.reply('🏠 *Main Menu*', { 
		parse_mode: 'Markdown',
		reply_markup: createMainMenu().reply_markup
	});
});

bot.hears('❓ Help', async (ctx) => {
	await ctx.reply(formatCommandsList(), { 
		parse_mode: 'Markdown',
		reply_markup: createHelpMenu().reply_markup
	});
});

bot.hears('❓ Commands List', async (ctx) => {
	await ctx.reply(formatCommandsList(), { 
		parse_mode: 'Markdown',
		reply_markup: createHelpMenu().reply_markup
	});
});

// Menu button handlers
bot.hears('📰 Latest News', async (ctx) => {
	const command = getCommandByDescription('📰 Latest Articles');
	if (command) {
		// Trigger the latest command
		await ctx.reply('Fetching latest articles...');
		try {
			const all = await fetchAllArticles();
			all.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
			const top = all.slice(0, 10);
			if (top.length === 0) return void (await ctx.reply('No recent articles available.'));
			
			const formatted = top.map(formatArticle).join('\n');
			await ctx.reply(`📰 Latest Articles (All Sources):\n\n${formatted}`, { 
				link_preview_options: { is_disabled: true },
				reply_markup: createMainMenu().reply_markup
			});
		} catch (err) {
			await ctx.reply('Failed to fetch latest articles.');
		}
	}
});

bot.hears('📅 Today', async (ctx) => {
	await ctx.reply('Fetching today\'s articles...');
	try {
		const all = await getRecentArticles(24);
		if (all.length === 0) return void (await ctx.reply('No articles from the last 24 hours.'));
		await ctx.reply(all.slice(0, 20).map(formatArticle).join('\n'), { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Failed to fetch today\'s articles.');
	}
});

bot.hears('📊 This Week', async (ctx) => {
	await ctx.reply('Fetching this week\'s articles...');
	try {
		const all = await getRecentArticles(24 * 7);
		if (all.length === 0) return void (await ctx.reply('No articles from the last 7 days.'));
		await ctx.reply(all.slice(0, 20).map(formatArticle).join('\n'), { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Failed to fetch this week\'s articles.');
	}
});

bot.hears('🛠️ AI Tools', async (ctx) => {
	await ctx.reply('Fetching AI tools...');
	try {
		const articles = await fetchAllArticles();
		const aiTools = filterArticlesByCategory(articles, 'AI Tool');
		if (aiTools.length === 0) return void (await ctx.reply('No AI tool articles found.'));
		
		const formatted = aiTools.slice(0, 10).map(formatArticle).join('\n');
		await ctx.reply(`🛠️ AI Tools & Apps:\n\n${formatted}`, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('AI tools command failed.');
	}
});

bot.hears('📰 Tech News', async (ctx) => {
	await ctx.reply('Fetching tech news...');
	try {
		const articles = await fetchAllArticles();
		const techNews = filterArticlesByCategory(articles, 'Tech News');
		if (techNews.length === 0) return void (await ctx.reply('No tech news articles found.'));
		
		const formatted = techNews.slice(0, 10).map(formatArticle).join('\n');
		await ctx.reply(`📰 Tech News Flash:\n\n${formatted}`, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Tech news command failed.');
	}
});

bot.hears('💼 Business', async (ctx) => {
	await ctx.reply('Fetching business articles...');
	try {
		const articles = await fetchAllArticles();
		const businessCases = filterArticlesByCategory(articles, 'Business Use-Case');
		if (businessCases.length === 0) return void (await ctx.reply('No business use-case articles found.'));
		
		const formatted = businessCases.slice(0, 10).map(formatArticle).join('\n');
		await ctx.reply(`💼 Business Use-Cases:\n\n${formatted}`, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Business command failed.');
	}
});

bot.hears('🔍 Jobs', async (ctx) => {
	await ctx.reply('Fetching job opportunities...');
	try {
		const articles = await fetchAllArticles(undefined, { maxAgeHours: 45 * 24 });
		const jobOpportunities = filterArticlesByCategory(articles, 'Job Opportunity');
		
		if (jobOpportunities.length === 0) {
			return void (await ctx.reply('No job opportunities found in the last 45 days.'));
		}
		
		const formatted = jobOpportunities.slice(0, 15).map(formatArticle).join('\n');
		const header = `🔍 Job Opportunities (Last 45 Days):\n\n`;
		await ctx.reply(`${header}${formatted}`, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Jobs command failed.');
	}
});

bot.hears('🤖 Analyze', async (ctx) => {
	await ctx.reply('Analyzing the latest unseen article with optimization...');
	try {
		const articles = await fetchAllArticles();
		const newOnes = await filterNewArticles(articles);
		if (newOnes.length === 0) {
			await ctx.reply('No new articles to analyze.');
			return;
		}
		const first = newOnes[0]!;
		const result = await getPostReadyAnalysis(first);
		const metrics = getAnalysisMetrics();
		
		const message = `
📰 ${first.title}
${first.link}

TL;DR: ${result.tldr}

Key takeaways:
• ${result.bullets[0] ?? ''}
• ${result.bullets[1] ?? ''}
• ${result.bullets[2] ?? ''}

Business implication:
${result.business_implication}

Audience: ${result.target_audience}

Description: ${result.description}

Hashtags: ${result.hashtags.map(tag => `#${tag}`).join(' ')}

⚡ Performance: ${metrics.cacheHitRate.toFixed(1)}% cache hit rate
`.trim();
		await ctx.reply(message, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Failed to analyze article.');
	}
});

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
		await sendPostWithImage(ctx.chat.id.toString(), message, testArticle.imageUrl);
	} catch (err) {
		await ctx.reply('Failed to create test post.');
	}
});

bot.hears('📡 Feeds', async (ctx) => {
	await ctx.reply('Fetching feeds...');
	try {
		const articles = await fetchAllArticles();
		const counts = new Map<string, number>();
		for (const a of articles) {
			try {
				const url = new URL(a.link);
				const host = url.hostname.replace(/^www\./, '');
				counts.set(host, (counts.get(host) || 0) + 1);
			} catch {}
		}
		const summary = Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([host, n]) => `${host}: ${n}`)
			.join('\n');
		await ctx.reply(summary || 'No articles found.', {
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Failed to fetch feeds.');
	}
});

bot.hears('📊 Categories', async (ctx) => {
	await ctx.reply('Categorizing recent articles...');
	try {
		const articles = await fetchAllArticles();
		const categorized = categorizeAllArticles(articles);
		
		const sources = new Map<string, number>();
		for (const article of articles) {
			const domain = getSourceDomain(article.link);
			sources.set(domain, (sources.get(domain) || 0) + 1);
		}
		
		let report = '📊 Article Categories:\n\n';
		report += `🛠️ AI Tools: ${categorized['AI Tool'].length}\n`;
		report += `📰 Tech News: ${categorized['Tech News'].length}\n`;
		report += `💼 Business Use-Cases: ${categorized['Business Use-Case'].length}\n`;
		report += `🔍 Job Opportunities: ${categorized['Job Opportunity'].length}\n`;
		report += `💰 Sponsored Deals: ${categorized['Sponsored Deal'].length}\n`;
		report += `💻 Developer Prompts: ${categorized['Developer Prompts'].length}\n`;
		
		const totalCategorized = Object.values(categorized).flat().length;
		const uncategorized = articles.length - totalCategorized;
		report += `❓ Uncategorized: ${uncategorized}\n`;
		report += `\nTotal: ${articles.length} articles\n\n`;
		
		report += '📊 Sources:\n';
		Array.from(sources.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.forEach(([domain, count]) => {
				report += `• ${domain}: ${count}\n`;
			});
		
		await ctx.reply(report, {
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Categories command failed.');
	}
});

bot.hears('📋 Raw', async (ctx) => {
	await ctx.reply('Fetching raw articles...');
	try {
		const articles = await fetchAllArticles();
		
		const sources = ['techcrunch.com', 'openai.com', 'technologyreview.com', 'theverge.com', 'huggingface.co', 'blog.google'];
		let report = '📰 Raw Articles by Source:\n\n';
		
		for (const source of sources) {
			const sourceArticles = articles.filter(a => getSourceDomain(a.link) === source).slice(0, 3);
			if (sourceArticles.length > 0) {
				report += `🔗 ${source} (${sourceArticles.length}):\n`;
				sourceArticles.forEach(a => {
					report += `• ${a.title.substring(0, 60)}...\n`;
				});
				report += '\n';
			}
		}
		
		await ctx.reply(report, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Raw command failed.');
	}
});

bot.hears('💻 Developer Prompts', async (ctx) => {
	await ctx.reply('Fetching developer prompts and GitHub repositories...');
	try {
		const articles = await fetchAllArticles();
		const promptArticles = filterArticlesByCategory(articles, 'Developer Prompts');
		
		if (promptArticles.length === 0) {
			await ctx.reply('No developer prompts or GitHub repositories found.', {
				reply_markup: createMainMenu().reply_markup
			});
			return;
		}
		
		// Sort by newest first
		promptArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
		
		let report = `💻 Developer Prompts & GitHub Repos (${promptArticles.length} found):\n\n`;
		
		const preview = promptArticles.slice(0, 5);
		preview.forEach((article, i) => {
			const domain = getSourceDomain(article.link);
			const timeAgo = getTimeAgo(article.pubDate);
			const isGitHub = domain === 'github.com';
			const emoji = isGitHub ? '🐙' : '💻';
			report += `${emoji} ${article.title.substring(0, 60)}...\n`;
			report += `   🔗 ${domain} • ⏰ ${timeAgo}\n\n`;
		});
		
		if (promptArticles.length > 5) {
			report += `... and ${promptArticles.length - 5} more`;
		}
		
		await ctx.reply(report, {
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply(`Developer prompts command failed: ${err}`, {
			reply_markup: createMainMenu().reply_markup
		});
	}
});

bot.hears('💻 Dev Prompts DB', async (ctx) => {
	await ctx.reply('Accessing Developer Prompts Database...');
	try {
		const categories = ['coding', 'debugging', 'code-review', 'documentation', 'testing', 'refactoring', 'architecture'];
		let message = '💻 **Developer Prompts Database**\n\n';
		message += `📚 **Available Categories:**\n`;
		categories.forEach(cat => {
			const count = getPromptsByCategory(cat as any).length;
			message += `• ${cat} (${count} prompts)\n`;
		});
		message += '\n💡 **Usage:**\n';
		message += '• `/devprompts` - Show all categories\n';
		message += '• `/devprompts coding` - Show coding prompts\n';
		message += '• `/devprompts random` - Get random prompt\n';
		message += '• `/devprompts search [keyword]` - Search prompts';
		
		await ctx.reply(message, {
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply(`Developer prompts database failed: ${err}`, {
			reply_markup: createMainMenu().reply_markup
		});
	}
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

bot.hears('🔧 Debug', async (ctx) => {
	await ctx.reply('Testing each feed individually...');
	try {
		const { DEFAULT_FEEDS } = await import('./data-aggregator');
		
		let report = 'Feed Status Report:\n\n';
		for (const feedUrl of DEFAULT_FEEDS) {
			try {
				const domain = new URL(feedUrl).hostname.replace(/^www\./, '');
				const { fetchRssFeed } = await import('./data-aggregator');
				const articles = await fetchRssFeed(feedUrl);
				report += `✅ ${domain}: ${articles.length} articles\n`;
			} catch (err: any) {
				const domain = new URL(feedUrl).hostname.replace(/^www\./, '');
				report += `❌ ${domain}: ${err.message || 'Error'}\n`;
			}
		}
		
		await ctx.reply(report, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Debug command failed.');
	}
});

bot.hears('⏱️ Scheduler', async (ctx) => {
	await ctx.reply('Testing scheduler logic...');
	try {
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
		
		const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
		const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
		const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
		
		let report = `🧪 Scheduler Test:\n\n`;
		report += `📁 Target Channel: ${targetChat}\n`;
		report += `🏷️ Target Category: ${targetCategory}\n`;
		report += `📊 Total Articles: ${articles.length}\n`;
		report += `🆕 New Articles: ${newOnes.length}\n`;
		report += `✅ Categorized: ${categorizedArticles.length}\n\n`;
		
		if (categorizedArticles.length > 0) {
			const a = categorizedArticles[0]!;
			report += `📰 Next to post:\n${a.title}\n${a.link}`;
		} else {
			report += `❌ No articles to post`;
		}
		
		await ctx.reply(report, { 
			link_preview_options: { is_disabled: true },
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply('Scheduler test failed.');
	}
});

bot.hears('📢 Channel', async (ctx) => {
	try {
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			return void (await ctx.reply('❌ TELEGRAM_TARGET_CHAT_ID not set in environment'));
		}
		
		await ctx.reply(`🧪 Testing post to channel: ${targetChat}`);
		
		const testMessage = `🤖 Test message from AI Pipeline Bot\n⏰ ${new Date().toISOString()}\n\nIf you see this, auto-posting is working!`;
		
		await bot.telegram.sendMessage(targetChat, testMessage);
		await ctx.reply(`✅ Successfully posted to ${targetChat}!`, {
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply(`❌ Failed to post to channel: ${err}`, {
			reply_markup: createMainMenu().reply_markup
		});
	}
});

// Debug command to check configuration
bot.command('debugai', async (ctx) => {
	counters.commandsHandled.inc({ command: 'debugai' });
	try {
		const hasGroqKey = !!process.env.GROQ_API_KEY;
		const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;
		const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
		
		let report = '🔍 AI Configuration Debug:\n\n';
		report += '📊 Available AI Providers:\n';
		report += `🚀 Groq: ${hasGroqKey ? '✅ Configured' : '❌ Missing'}\n`;
		report += `🧠 DeepSeek: ${hasDeepSeekKey ? '✅ Configured' : '❌ Missing'}\n`;
		report += `🤖 OpenAI: ${hasOpenAIKey ? '✅ Configured' : '❌ Missing'}\n\n`;
		
		// Show which provider will be used (priority: Groq > DeepSeek > OpenAI)
		let activeProvider = 'None';
		if (hasGroqKey) activeProvider = '🚀 Groq (Primary)';
		else if (hasDeepSeekKey) activeProvider = '🧠 DeepSeek (Secondary)';
		else if (hasOpenAIKey) activeProvider = '🤖 OpenAI (Fallback)';
		
		report += `🎯 Active Provider: ${activeProvider}\n\n`;
		
		if (hasGroqKey || hasDeepSeekKey || hasOpenAIKey) {
			report += '🧪 Testing AI Analysis...\n';
			try {
				const testArticle = {
					title: 'Test AI Analysis with Multiple Providers',
					link: 'https://example.com/test',
					contentSnippet: 'This is a test article to verify AI analysis is working properly with the configured provider.',
					pubDate: new Date().toISOString()
				};
				
				const analysis = await analyzeArticle(testArticle);
				report += `✅ AI Analysis Success!\n`;
				report += `📝 Description: ${analysis.description.substring(0, 80)}...\n`;
				report += `🏷️ Hashtags: ${analysis.hashtags.slice(0, 4).join(', ')}\n`;
				report += `💼 Business Impact: ${analysis.business_implication.substring(0, 60)}...\n`;
			} catch (aiErr) {
				report += `❌ AI Analysis Failed: ${aiErr}\n`;
			}
		} else {
			report += '❌ No AI providers configured\n\n';
			report += '🛠️ To fix, set one of these API keys:\n';
			report += '• GROQ_API_KEY (Recommended - Fast & Cheap)\n';
			report += '• DEEPSEEK_API_KEY (Good alternative)\n';
			report += '• OPENAI_API_KEY (Premium option)\n';
		}
		
		await ctx.reply(report, {
			reply_markup: createMainMenu().reply_markup
		});
	} catch (err) {
		await ctx.reply(`Debug failed: ${err}`, {
			reply_markup: createMainMenu().reply_markup
		});
	}
});

bot.command('duplicates', async (ctx) => {
	counters.commandsHandled.inc({ command: 'duplicates' });
	try {
		const { loadPostedIds } = await import('./storage');
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
			preview.forEach((article, i) => {
				const domain = getSourceDomain(article.link);
				const timeAgo = getTimeAgo(article.pubDate);
				report += `${i + 1}. ${domain} (${timeAgo}): ${article.title.substring(0, 40)}...\n`;
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

bot.command('performance', async (ctx) => {
	counters.commandsHandled.inc({ command: 'performance' });
	try {
		const metrics = getAnalysisMetrics();
		const { getAnalysisCacheStats } = await import('./storage/analysis-cache');
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

bot.command('devprompts', async (ctx) => {
	counters.commandsHandled.inc({ command: 'devprompts' });
	try {
		const args = ctx.message.text.split(' ').slice(1);
		
		if (args.length === 0) {
			// Show all categories
			const categories = ['coding', 'debugging', 'code-review', 'documentation', 'testing', 'refactoring', 'architecture'];
			let message = '💻 **Developer Prompts Database**\n\n';
			message += `📚 **Available Categories:**\n`;
			categories.forEach(cat => {
				const count = getPromptsByCategory(cat as any).length;
				message += `• ${cat} (${count} prompts)\n`;
			});
			message += '\n💡 **Usage:**\n';
			message += '• `/devprompts` - Show all categories\n';
			message += '• `/devprompts coding` - Show coding prompts\n';
			message += '• `/devprompts random` - Get random prompt\n';
			message += '• `/devprompts search [keyword]` - Search prompts';
			
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			return;
		}
		
		const command = args[0]?.toLowerCase() || '';
		
		if (command === 'random') {
			const randomPrompt = getRandomPrompt();
			const message = formatPromptForTelegram(randomPrompt, true);
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			return;
		}
		
		if (command === 'search') {
			const searchTerm = args.slice(1).join(' ');
			if (!searchTerm) {
				await ctx.reply('Please provide a search term. Example: `/devprompts search api`', {
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}
			
			const results = searchPrompts(searchTerm);
			if (results.length === 0) {
				await ctx.reply(`No prompts found for "${searchTerm}"`, {
					reply_markup: createMainMenu().reply_markup
				});
				return;
			}
			
			let message = `🔍 **Search Results for "${searchTerm}"** (${results.length} found)\n\n`;
			results.slice(0, 5).forEach((prompt, index) => {
				message += `${index + 1}. **${prompt.title}**\n`;
				message += `   ${prompt.description}\n\n`;
			});
			
			if (results.length > 5) {
				message += `... and ${results.length - 5} more results`;
			}
			
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			return;
		}
		
		// Show prompts by category
		const validCategories = ['coding', 'debugging', 'code-review', 'documentation', 'testing', 'refactoring', 'architecture'];
		if (validCategories.includes(command)) {
			const message = getPromptsForTelegramByCategory(command as any);
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			return;
		}
		
		// Try to find prompt by ID
		const prompt = DEVELOPER_PROMPTS.find(p => p.id === command);
		if (prompt) {
			const message = formatPromptForTelegram(prompt, true);
			await ctx.reply(message, {
				reply_markup: createMainMenu().reply_markup
			});
			return;
		}
		
		await ctx.reply(`Invalid command. Use \`/devprompts\` to see available options.`, {
			reply_markup: createMainMenu().reply_markup
		});
		
	} catch (err) {
		await ctx.reply(`Developer prompts command failed: ${err}`, {
			reply_markup: createMainMenu().reply_markup
		});
	}
});

bot.command('github', async (ctx) => {
	counters.commandsHandled.inc({ command: 'github' });
	try {
		await ctx.reply('🔍 Fetching trending AI/ML repositories...');
		
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

bot.command('resetcache', async (ctx) => {
	counters.commandsHandled.inc({ command: 'resetcache' });
	try {
		const fs = require('fs');
		const path = require('path');
		
		await ctx.reply('🧹 Resetting cache files...');
		
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
			reply_markup: createMainMenu().reply_markup
		});
		
	} catch (err) {
		await ctx.reply(`Cache reset failed: ${err}`, {
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

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot
	.launch()
	.then(() => {
		logger.info('Bot started. Send /start to test.');
		// Scheduler: every 30 seconds
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			logger.warn('TELEGRAM_TARGET_CHAT_ID not set; scheduler will not post');
		}
		cron.schedule('* * * * * *', async () => {
			counters.cronRuns.inc();
			try {
				const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
				// Ensure articles are sorted by newest first before filtering
				articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
				const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
				// Sort new articles by publication date (newest first)
				newOnes.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
				
				logger.debug({ 
					totalArticles: articles.length,
					newArticles: newOnes.length,
					hasTargetChat: !!targetChat,
					newestDate: articles[0]?.pubDate
				}, 'scheduler: fetched and filtered articles');
				
				if (!targetChat || newOnes.length === 0) {
					if (!targetChat) {
						logger.debug('scheduler: no target chat configured');
					} else {
						logger.debug('scheduler: no new articles to post');
					}
					return;
				}
				
				// Filter by target category (default to AI Tool)
				const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
				const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
				// Ensure categorized articles are sorted by newest first
				categorizedArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
				
				logger.debug({ 
					targetCategory, 
					totalNew: newOnes.length,
					categorizedCount: categorizedArticles.length,
					newestCategorizedDate: categorizedArticles[0]?.pubDate
				}, 'scheduler: filtered by category');
				
				if (categorizedArticles.length === 0) {
					logger.debug({ targetCategory, totalNew: newOnes.length }, 'scheduler: no articles in target category');
					return;
				}
				
				// Post the first categorized article
				const a = categorizedArticles[0]!;
				const categoryEmoji = {
					'AI Tool': '🛠️',
					'Tech News': '📰',
					'Business Use-Case': '💼',
					'Job Opportunity': '🔍',
					'Sponsored Deal': '💰',
					'Developer Prompts': '💻'
				}[targetCategory];
				
				// Double-check this article hasn't been posted (extra safety)
				const { getArticleId } = await import('./storage');
				const { loadPostedIds } = await import('./storage');
				const postedIds = await loadPostedIds();
				const articleId = getArticleId(a);
				
				if (postedIds.has(articleId)) {
					logger.warn({ 
						title: a.title, 
						link: a.link,
						articleId 
					}, 'scheduler: article already posted (duplicate detected)');
					return;
				}
				
				logger.info({ 
					title: a.title, 
					link: a.link, 
					category: targetCategory,
					articleId 
				}, 'scheduler: posting new article to channel');
				
				const message = await createEnhancedPost(a);
				await sendPostWithImage(targetChat, message, a.imageUrl);
				await markArticlesPosted([a]);
				counters.postsSent.inc();
				
				logger.info({ 
					title: a.title, 
					link: a.link, 
					category: targetCategory,
					articleId,
					messageLength: message.length 
				}, 'scheduler: successfully posted article to channel');
				
			} catch (err) {
				counters.cronErrors.inc();
				logger.error({ err }, 'scheduler run failed');
			}
		});
	})
	.catch((err) => {
		logger.error({ err }, 'Failed to launch bot');
		process.exit(1);
	});


