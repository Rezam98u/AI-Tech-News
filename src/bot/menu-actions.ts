/**
 * Shared handlers for reply keyboard and matching slash commands.
 */
import type { Context } from 'telegraf';
import { createMainMenu } from '../utils/menu';
import { fetchAllArticles } from '../data-aggregator';
import { filterNewArticles } from '../storage';
import { categorizeAllArticles, filterArticlesByCategory, ContentCategory } from '../categorizer';
import { getTimeAgo, getSourceDomain } from '../utils/time';
export async function sendTechNewsReport(ctx: Context): Promise<void> {
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

		await ctx.reply(report, { reply_markup: createMainMenu().reply_markup });
	} catch {
		await ctx.reply('Failed to fetch tech news.', { reply_markup: createMainMenu().reply_markup });
	}
}

export async function sendFeedsReport(ctx: Context): Promise<void> {
	await ctx.reply('Fetching feeds...');
	try {
		const articles = await fetchAllArticles();
		const newOnes = await filterNewArticles(articles);

		let report = `📡 Feed Status Report:\n\n`;
		report += `📊 **Statistics:**\n`;
		report += `• Total articles: ${articles.length}\n`;
		report += `• New articles: ${newOnes.length}\n`;

		const bySource: { [key: string]: typeof articles } = {};
		articles.forEach((article) => {
			const domain = getSourceDomain(article.link);
			if (!bySource[domain]) bySource[domain] = [];
			bySource[domain]!.push(article);
		});

		report += `• Active sources: ${Object.keys(bySource).length}\n\n`;

		report += `📰 **Sources:**\n`;
		Object.entries(bySource)
			.sort(([, a], [, b]) => b.length - a.length)
			.forEach(([source, sourceArticles]) => {
				const newest = sourceArticles.sort((a, b) => b.pubDate.localeCompare(a.pubDate))[0];
				const timeAgo = newest ? getTimeAgo(newest.pubDate) : 'N/A';
				report += `• ${source}: ${sourceArticles.length} articles (latest: ${timeAgo})\n`;
			});

		await ctx.reply(report, { reply_markup: createMainMenu().reply_markup });
	} catch {
		await ctx.reply('Failed to fetch feeds.', { reply_markup: createMainMenu().reply_markup });
	}
}

export async function sendCategoriesReport(ctx: Context): Promise<void> {
	try {
		const articles = await fetchAllArticles();
		const categorized = categorizeAllArticles(articles);

		let report = `📊 Article Categories (${articles.length} total):\n\n`;

		Object.entries(categorized).forEach(([category, categoryArticles]) => {
			const categoryEmoji =
				{
					'AI Tool': '🛠️',
					'Tech News': '📰',
					'Business Use-Case': '💼',
					'Job Opportunity': '🔍',
					'Sponsored Deal': '💰',
					'Developer Prompts': '💻',
				}[category as ContentCategory] || '📋';
			const percentage = ((categoryArticles.length / articles.length) * 100).toFixed(1);
			report += `${categoryEmoji} **${category}**\n`;
			report += `   ${categoryArticles.length} articles (${percentage}%)\n\n`;
		});

		const sortedCategories = Object.entries(categorized)
			.sort(([, a], [, b]) => b.length - a.length)
			.slice(0, 3);

		if (sortedCategories.length > 0) {
			report += `🏆 **Top Categories:**\n`;
			sortedCategories.forEach(([category, categoryArticles], index) => {
				const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
				report += `${medal} ${category}: ${categoryArticles.length} articles\n`;
			});
		}

		await ctx.reply(report, { reply_markup: createMainMenu().reply_markup });
	} catch {
		await ctx.reply('Failed to categorize articles.', { reply_markup: createMainMenu().reply_markup });
	}
}
