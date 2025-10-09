import { Markup } from 'telegraf';

export interface MenuCommand {
	command: string;
	description: string;
	category: 'main' | 'news' | 'tools' | 'admin';
}

export const MENU_COMMANDS: MenuCommand[] = [
	// Main commands
	{ command: 'start', description: '🚀 Start Bot & Latest News', category: 'main' },
	
	// News categories
	{ command: 'aitools', description: '🛠️ AI Tools & Apps', category: 'news' },
	{ command: 'technews', description: '📰 Tech News Flash', category: 'news' },
	{ command: 'business', description: '💼 Business Use-Cases', category: 'news' },
	{ command: 'jobs', description: '🔍 Job Opportunities', category: 'news' },
	{ command: 'prompts', description: '💻 Developer Prompts', category: 'news' },
	
	// Tools
	{ command: 'analyze', description: '🤖 AI Analysis', category: 'tools' },
	{ command: 'testpost', description: '🧪 Test Enhanced Post', category: 'tools' },
	{ command: 'testenglish', description: '🇺🇸 Test English Post', category: 'tools' },
	{ command: 'feeds', description: '📡 Feed Status', category: 'tools' },
	{ command: 'fetchfeed', description: '🎯 Fetch Specific Feed', category: 'tools' },
	{ command: 'categories', description: '📊 Article Categories', category: 'tools' },
	{ command: 'raw', description: '📋 Raw Articles', category: 'tools' },
	{ command: 'recent', description: '⏰ Recent Articles', category: 'tools' },
	{ command: 'devprompts', description: '💻 Dev Prompts DB', category: 'tools' },
	{ command: 'github', description: '🐙 GitHub Trending', category: 'tools' },
	{ command: 'performance', description: '⚡ Performance Stats', category: 'tools' },
	{ command: 'duplicates', description: '🔍 Duplicate Check', category: 'tools' },
	
	// Admin
	{ command: 'debug', description: '🔧 Debug Feeds', category: 'admin' },
	{ command: 'schedulertest', description: '⏱️ Scheduler Test', category: 'admin' },
	{ command: 'channeltest', description: '📢 Channel Test', category: 'admin' },
	{ command: 'resetcache', description: '🧹 Reset Cache', category: 'admin' },
	{ command: 'cleanseen', description: '🗑️ Clear Seen Articles', category: 'admin' },
	{ command: 'deletechannel', description: '🗑️ Delete All Channel Posts', category: 'admin' },
	{ command: 'deletelast', description: '🗑️ Delete Recent Posts', category: 'admin' },
	{ command: 'toggleposting', description: '🔄 Toggle Auto Posting', category: 'admin' },
	{ command: 'togglepreview', description: '👁️ Toggle Preview Mode', category: 'admin' },
	{ command: 'postingstatus', description: '📊 Posting Status', category: 'admin' },
];

export function createMainMenu() {
	return Markup.keyboard([
		['🛠️ AI Tools', '📰 Tech News', '💼 Business'],
		['🔍 Jobs', '💻 Developer Prompts', '📊 Categories'],
		['🧪 Test Post', '🇺🇸 Test English', '📡 Feeds'],
		['📋 Raw', '💻 Dev Prompts DB', '🐙 GitHub Trending'],
		['🤖 Analyze', '⚡ Performance', '📊 Posting Status'],
		['🔄 Toggle Auto Posting', '📊 Posting Control', '🔧 Admin Tools'],
		['❓ Help', '📱 Menu']
	]).resize().persistent();
}

// Removed unused createCategoryMenu and createToolsMenu functions

export function createPostingControlMenu() {
	return Markup.keyboard([
		['📊 Posting Status', '🔄 Toggle Auto Posting'],
		['👁️ Toggle Preview Mode', '✅ Enable Auto Posting'],
		['⏱️ Scheduler Test', '📢 Channel Test'],
		['🏠 Main Menu']
	]).resize().persistent();
}

export function createAdminMenu() {
	return Markup.keyboard([
		['🔧 Debug Feeds', '⏱️ Scheduler Test', '📢 Channel Test'],
		['🧹 Reset Cache', '🗑️ Clear Seen Articles'],
		['🗑️ Delete All Posts', '🗑️ Delete Recent Posts'],
		['⚡ Performance Stats', '🔍 Duplicate Check'],
		['📊 Posting Control', '🏠 Main Menu']
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
	
	let result = '📱 <b>AI Tech News Bot Commands</b>\n\n';
	
	Object.entries(categories).forEach(([category, title]) => {
		result += `<b>${title}</b>\n`;
		const categoryCommands = MENU_COMMANDS.filter(cmd => cmd.category === category);
		categoryCommands.forEach(cmd => {
			result += `/${cmd.command} - ${cmd.description}\n`;
		});
		result += '\n';
	});
	
	return result;
}
