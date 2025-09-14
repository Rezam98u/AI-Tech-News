import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { fetchAllArticles } from './data-aggregator';
import { filterNewArticles } from './storage';
import { analyzeArticle } from './ai-analysis';
import { logger } from './logger';
import { counters, startMetricsServer } from './metrics';

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
	await ctx.reply('The AI Pipeline Bot is online. Fetching latest AI news...');
	try {
		const articles = await fetchAllArticles();
		const newOnes = await filterNewArticles(articles);
		const preview = newOnes.slice(0, 3).map((a, i) => `${i + 1}. ${a.title}\n${a.link}`).join('\n\n');
		await ctx.reply(preview || 'No articles found right now.');
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
	})
	.catch((err) => {
		logger.error({ err }, 'Failed to launch bot');
		process.exit(1);
	});


