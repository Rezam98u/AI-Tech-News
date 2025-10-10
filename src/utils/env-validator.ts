/**
 * Environment variable validation utilities
 */
import { logger } from '../logger';

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export interface EnvConfig {
	botToken: string;
	aiProvider: {
		name: 'openai' | 'deepseek' | 'groq' | 'gemini' | 'huggingface';
		apiKey: string;
		model?: string;
	};
	targetChatId?: string;
	targetCategory: string;
	metricsPort: number;
	autoPostingEnabled: boolean;
	githubToken?: string;
	smartRouting?: boolean;
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Validate BOT_TOKEN
	if (!process.env.BOT_TOKEN) {
		errors.push('BOT_TOKEN is required. Get one from @BotFather on Telegram.');
	} else if (!process.env.BOT_TOKEN.includes(':')) {
		errors.push('BOT_TOKEN appears to be invalid. It should contain a colon (:).');
	}

	// Validate AI Provider (at least one must be set)
	const hasGroq = !!process.env.GROQ_API_KEY;
	const hasGemini = !!process.env.GEMINI_API_KEY;
	const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
	const hasHuggingFace = !!process.env.HUGGINGFACE_API_KEY;
	const hasOpenAI = !!process.env.OPENAI_API_KEY;

	if (!hasGroq && !hasGemini && !hasDeepSeek && !hasHuggingFace && !hasOpenAI) {
		errors.push(
			'No AI provider API key found. Set one of:\n' +
			'  - GROQ_API_KEY (fast & free - 14,400 req/day)\n' +
			'  - GEMINI_API_KEY (recommended - Google Gemini 2.5 Flash)\n' +
			'  - DEEPSEEK_API_KEY (great reasoning)\n' +
			'  - HUGGINGFACE_API_KEY (free - 30,000 req/month)\n' +
			'  - OPENAI_API_KEY (premium option)'
		);
	}

	// Validate TELEGRAM_TARGET_CHAT_ID (optional but warn if missing)
	if (!process.env.TELEGRAM_TARGET_CHAT_ID) {
		warnings.push('TELEGRAM_TARGET_CHAT_ID not set. Automatic posting will be disabled.');
	} else {
		const chatId = process.env.TELEGRAM_TARGET_CHAT_ID;
		// Valid formats: @channel, -100123456789, 123456789
		if (!chatId.startsWith('@') && !chatId.startsWith('-') && isNaN(Number(chatId))) {
			warnings.push(
				'TELEGRAM_TARGET_CHAT_ID may be invalid. Valid formats:\n' +
				'  - @channelname (for public channels)\n' +
				'  - -100123456789 (for private channels/groups)\n' +
				'  - 123456789 (for user chats)'
			);
		}
	}

	// Validate TARGET_CATEGORY (optional)
	const validCategories = ['AI Tool', 'AI News', 'AI Research', 'AI Industry'];
	const targetCategory = process.env.TARGET_CATEGORY;
	if (targetCategory && !validCategories.includes(targetCategory)) {
		warnings.push(
			`TARGET_CATEGORY="${targetCategory}" is not a standard category. ` +
			`Valid options: ${validCategories.join(', ')}`
		);
	}

	// Validate METRICS_PORT (optional)
	if (process.env.METRICS_PORT) {
		const port = Number(process.env.METRICS_PORT);
		if (isNaN(port) || port < 1 || port > 65535) {
			errors.push('METRICS_PORT must be a number between 1 and 65535.');
		}
	}

	// Validate AUTO_POSTING_ENABLED (optional)
	if (process.env.AUTO_POSTING_ENABLED) {
		const value = process.env.AUTO_POSTING_ENABLED.toLowerCase();
		if (value !== 'true' && value !== 'false') {
			warnings.push('AUTO_POSTING_ENABLED should be "true" or "false".');
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings
	};
}

/**
 * Get validated environment configuration
 */
export function getEnvConfig(): EnvConfig {
	const validation = validateEnvironment();
	
	// Log warnings
	if (validation.warnings.length > 0) {
		validation.warnings.forEach(warning => {
			logger.warn({ warning }, 'Environment configuration warning');
		});
	}

	// Throw errors if validation failed
	if (!validation.valid) {
		const errorMessage = validation.errors.join('\n');
		logger.fatal({ errors: validation.errors }, 'Environment validation failed');
		throw new Error(`Environment validation failed:\n${errorMessage}`);
	}

	// Determine AI provider (priority order)
	let aiProvider: EnvConfig['aiProvider'];
	if (process.env.GROQ_API_KEY) {
		const groqModel = process.env.GROQ_MODEL;
		aiProvider = groqModel 
			? { name: 'groq', apiKey: process.env.GROQ_API_KEY, model: groqModel }
			: { name: 'groq', apiKey: process.env.GROQ_API_KEY };
	} else if (process.env.GEMINI_API_KEY) {
		const geminiModel = process.env.GEMINI_MODEL;
		aiProvider = geminiModel 
			? { name: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: geminiModel }
			: { name: 'gemini', apiKey: process.env.GEMINI_API_KEY };
	} else if (process.env.DEEPSEEK_API_KEY) {
		const deepseekModel = process.env.DEEPSEEK_MODEL;
		aiProvider = deepseekModel 
			? { name: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY, model: deepseekModel }
			: { name: 'deepseek', apiKey: process.env.DEEPSEEK_API_KEY };
	} else if (process.env.HUGGINGFACE_API_KEY) {
		const hfModel = process.env.HUGGINGFACE_MODEL;
		aiProvider = hfModel 
			? { name: 'huggingface', apiKey: process.env.HUGGINGFACE_API_KEY, model: hfModel }
			: { name: 'huggingface', apiKey: process.env.HUGGINGFACE_API_KEY };
	} else if (process.env.OPENAI_API_KEY) {
		const openaiModel = process.env.OPENAI_MODEL;
		aiProvider = openaiModel 
			? { name: 'openai', apiKey: process.env.OPENAI_API_KEY, model: openaiModel }
			: { name: 'openai', apiKey: process.env.OPENAI_API_KEY };
	} else {
		throw new Error('No AI provider configured (this should not happen after validation)');
	}

	// Build config with required fields first
	const config: EnvConfig = {
		botToken: process.env.BOT_TOKEN!,
		aiProvider,
		targetCategory: process.env.TARGET_CATEGORY || 'AI Tool',
		metricsPort: Number(process.env.METRICS_PORT) || 3000,
		autoPostingEnabled: process.env.AUTO_POSTING_ENABLED === 'true',
		smartRouting: process.env.ENABLE_SMART_ROUTING === 'true'
	};

	// Add optional properties only if they exist
	if (process.env.TELEGRAM_TARGET_CHAT_ID) {
		config.targetChatId = process.env.TELEGRAM_TARGET_CHAT_ID;
	}
	if (process.env.GITHUB_TOKEN) {
		config.githubToken = process.env.GITHUB_TOKEN;
	}

	return config;
}

/**
 * Print environment configuration (safe for logging)
 */
export function printEnvConfig(): void {
	try {
		const config = getEnvConfig();
		
		logger.info({
			aiProvider: config.aiProvider.name,
			model: config.aiProvider.model || 'default',
			smartRouting: config.smartRouting || false,
			hasTargetChat: !!config.targetChatId,
			targetCategory: config.targetCategory,
			metricsPort: config.metricsPort,
			autoPostingEnabled: config.autoPostingEnabled,
			hasGithubToken: !!config.githubToken
		}, 'Environment configuration loaded successfully');
	} catch (err) {
		// Error already logged in getEnvConfig
		throw err;
	}
}
