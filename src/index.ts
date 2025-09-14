import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { fetchAllArticles, getRecentArticles } from './data-aggregator';
import { filterNewArticles } from './storage';
import { analyzeArticle } from './ai-analysis';
import { logger } from './logger';
import { counters, startMetricsServer } from './metrics';
import { getTimeAgo, getSourceDomain } from './utils/time';
import cron from 'node-cron';
import { markArticlesPosted } from './storage';
import { categorizeArticle, filterArticlesByCategory, categorizeAllArticles, ContentCategory } from './categorizer';

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
	await ctx.reply('The AI Pipeline Bot is online. Fetching latest AI news from all sources...');
	try {
		// Get all articles without age restriction to see the very latest
		const articles = await fetchAllArticles();
		
		// Sort by publication date (newest first) - this ensures we get the absolute latest
		articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate));
		
		// Show the 6 most recent articles from ANY source, with time and source info
		const preview = articles.slice(0, 6).map((a, i) => {
			const timeAgo = getTimeAgo(a.pubDate);
			const domain = getSourceDomain(a.link);
			return `${i + 1}. [${timeAgo}] ${domain}\n📰 ${a.title}\n🔗 ${a.link}`;
		}).join('\n\n');
		
		await ctx.reply(preview || 'No articles found right now.', { 
			link_preview_options: { is_disabled: true } 
		});
		
		logger.info({ 
			totalArticles: articles.length,
			shown: Math.min(6, articles.length),
			newestDate: articles[0]?.pubDate 
		}, 'start command showed latest articles');
		
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
		const articles = await fetchAllArticles();
		const jobOpportunities = filterArticlesByCategory(articles, 'Job Opportunity');
		if (jobOpportunities.length === 0) return void (await ctx.reply('No job opportunity articles found.'));
		
		const formatted = jobOpportunities.slice(0, 15).map(formatArticle).join('\n');
		await ctx.reply(`🔍 Job Opportunities:\n\n${formatted}`, { link_preview_options: { is_disabled: true } });
		
		logger.info({ 
			totalArticles: articles.length,
			jobsFound: jobOpportunities.length,
			shown: Math.min(15, jobOpportunities.length)
		}, 'jobs command showed job opportunities');
		
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
		const sources = ['techcrunch.com', 'openai.com', 'technologyreview.com', 'wired.com', 'theverge.com', 'huggingface.co', 'blog.google'];
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

bot.command('testpost', async (ctx) => {
	counters.commandsHandled.inc({ command: 'testpost' });
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
		counters.errorsTotal.inc({ scope: 'testpost' });
		await ctx.reply('Test post failed.');
		logger.error({ err }, 'testpost command failed');
	}
});

function formatArticle(a: { title: string; link: string; pubDate: string }): string {
	const ago = getTimeAgo(a.pubDate);
	const domain = getSourceDomain(a.link);
	return `🕐 ${ago} • ${domain}\n📰 ${a.title}\n🔗 ${a.link}\n---`;
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
`.trim();
		await ctx.reply(message, { link_preview_options: { is_disabled: true } });
	} catch (err) {
		counters.errorsTotal.inc({ scope: 'analyze' });
		await ctx.reply('Failed to analyze article.');
		logger.error({ err }, 'analyze command failed');
	}
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot
	.launch()
	.then(() => {
		logger.info('Bot started. Send /start to test.');
		// Scheduler: every minute
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			logger.warn('TELEGRAM_TARGET_CHAT_ID not set; scheduler will not post');
		}
		cron.schedule('* * * * *', async () => {
			counters.cronRuns.inc();
			try {
				const articles = await fetchAllArticles(undefined, { maxAgeHours: 24 * 7 });
				const newOnes = await filterNewArticles(articles, { maxAgeHours: 24 * 7 });
				if (!targetChat || newOnes.length === 0) return;
				
				// Filter by target category (default to AI Tool)
				const targetCategory = (process.env.TARGET_CATEGORY as ContentCategory) || 'AI Tool';
				const categorizedArticles = filterArticlesByCategory(newOnes, targetCategory);
				
				if (categorizedArticles.length === 0) {
					logger.debug({ targetCategory, totalNew: newOnes.length }, 'no articles in target category');
					return;
				}
				
				// Post the first categorized article
				const a = categorizedArticles[0]!;
				const categoryEmoji = {
					'AI Tool': '🛠️',
					'Tech News': '📰',
					'Business Use-Case': '💼',
					'Job Opportunity': '🔍',
					'Sponsored Deal': '💰'
				}[targetCategory];
				
				const message = `${categoryEmoji} ${targetCategory}\n🕐 ${getTimeAgo(a.pubDate)} • ${getSourceDomain(a.link)}\n📰 ${a.title}\n🔗 ${a.link}`;
				await bot.telegram.sendMessage(targetChat, message, { link_preview_options: { is_disabled: true } });
				await markArticlesPosted([a]);
				counters.postsSent.inc();
				logger.info({ title: a.title, link: a.link, category: targetCategory }, 'posted categorized article');
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


