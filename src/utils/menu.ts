import { Telegraf, Markup } from 'telegraf';

export interface MenuCommand {
	command: string;
	description: string;
	category: 'main' | 'news' | 'tools' | 'admin';
}

export const MENU_COMMANDS: MenuCommand[] = [
	// Main commands
	{ command: 'start', description: '🚀 Start Bot & Latest News', category: 'main' },
	{ command: 'latest', description: '📰 Latest Articles', category: 'main' },
	{ command: 'today', description: '📅 Today\'s News', category: 'main' },
	{ command: 'week', description: '📊 This Week\'s News', category: 'main' },
	
	// News categories
	{ command: 'aitools', description: '🛠️ AI Tools & Apps', category: 'news' },
	{ command: 'technews', description: '📰 Tech News Flash', category: 'news' },
	{ command: 'business', description: '💼 Business Use-Cases', category: 'news' },
	{ command: 'jobs', description: '🔍 Job Opportunities', category: 'news' },
	
	// Tools
	{ command: 'analyze', description: '🤖 AI Analysis', category: 'tools' },
	{ command: 'testpost', description: '🧪 Test Enhanced Post', category: 'tools' },
	{ command: 'feeds', description: '📡 Feed Status', category: 'tools' },
	{ command: 'categories', description: '📊 Article Categories', category: 'tools' },
	{ command: 'raw', description: '📋 Raw Articles', category: 'tools' },
	{ command: 'recent', description: '⏰ Recent Articles', category: 'tools' },
	
	// Admin
	{ command: 'debug', description: '🔧 Debug Feeds', category: 'admin' },
	{ command: 'schedulertest', description: '⏱️ Scheduler Test', category: 'admin' },
	{ command: 'channeltest', description: '📢 Channel Test', category: 'admin' },
];

export function createMainMenu() {
	return Markup.keyboard([
		['📰 Latest News', '📅 Today', '📊 This Week'],
		['🛠️ AI Tools', '📰 Tech News', '💼 Business'],
		['🔍 Jobs', '🤖 Analyze', '🧪 Test Post'],
		['📡 Feeds', '📊 Categories', '📋 Raw'],
		['🔧 Debug', '⏱️ Scheduler', '📢 Channel'],
		['❓ Help', '📱 Menu']
	]).resize().persistent();
}

export function createCategoryMenu() {
	return Markup.keyboard([
		['🛠️ AI Tools', '📰 Tech News', '💼 Business'],
		['🔍 Jobs', '📊 Categories', '📋 Raw'],
		['🏠 Main Menu']
	]).resize().persistent();
}

export function createToolsMenu() {
	return Markup.keyboard([
		['🤖 Analyze', '🧪 Test Post', '📡 Feeds'],
		['📊 Categories', '📋 Raw', '⏰ Recent'],
		['🏠 Main Menu']
	]).resize().persistent();
}

export function createAdminMenu() {
	return Markup.keyboard([
		['🔧 Debug', '⏱️ Scheduler', '📢 Channel'],
		['🏠 Main Menu']
	]).resize().persistent();
}

export function createHelpMenu() {
	return Markup.keyboard([
		['📱 Main Menu', '❓ Commands List']
	]).resize().persistent();
}

export function getCommandByDescription(description: string): string | null {
	const command = MENU_COMMANDS.find(cmd => cmd.description === description);
	return command ? command.command : null;
}

export function getDescriptionByCommand(command: string): string | null {
	const cmd = MENU_COMMANDS.find(cmd => cmd.command === command);
	return cmd ? cmd.description : null;
}

export function formatCommandsList(): string {
	const categories = {
		main: '🚀 Main Commands',
		news: '📰 News Categories', 
		tools: '🛠️ Tools & Analysis',
		admin: '🔧 Admin Tools'
	};
	
	let result = '📱 *AI Tech News Bot Commands*\n\n';
	
	Object.entries(categories).forEach(([category, title]) => {
		result += `*${title}*\n`;
		const categoryCommands = MENU_COMMANDS.filter(cmd => cmd.category === category);
		categoryCommands.forEach(cmd => {
			result += `/${cmd.command} - ${cmd.description}\n`;
		});
		result += '\n';
	});
	
	return result;
}
