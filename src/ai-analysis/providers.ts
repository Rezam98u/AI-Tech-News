import OpenAI from 'openai';
import Groq from 'groq-sdk';
import axios from 'axios';
import { Article, AnalysisResult } from '../types';
import { logger } from '../logger';

export type AIProvider = 'openai' | 'deepseek' | 'groq';

export interface AIProviderConfig {
	provider: AIProvider;
	apiKey: string;
	model?: string;
}

// AI Provider implementations
class OpenAIProvider {
	private client: OpenAI;
	private model: string;

	constructor(apiKey: string, model: string = 'gpt-4o-mini') {
		this.client = new OpenAI({ apiKey });
		this.model = model;
	}

	async analyze(prompt: string): Promise<any> {
		const response = await this.client.chat.completions.create({
			model: this.model,
			messages: [
				{ role: 'system', content: 'Return ONLY valid JSON. No prose outside JSON.' },
				{ role: 'user', content: prompt },
			],
			temperature: 0.3,
		});

		const content = response.choices?.[0]?.message?.content ?? '';
		const jsonText = content.trim().replace(/^```json\n?|```$/g, '');
		return JSON.parse(jsonText);
	}
}

class DeepSeekProvider {
	private apiKey: string;
	private model: string;
	private baseURL: string;

	constructor(apiKey: string, model: string = 'deepseek-chat') {
		this.apiKey = apiKey;
		this.model = model;
		this.baseURL = 'https://api.deepseek.com/v1';
	}

	async analyze(prompt: string): Promise<any> {
		const response = await axios.post(
			`${this.baseURL}/chat/completions`,
			{
				model: this.model,
				messages: [
					{ role: 'system', content: 'Return ONLY valid JSON. No prose outside JSON.' },
					{ role: 'user', content: prompt },
				],
				temperature: 0.3,
			},
			{
				headers: {
					'Authorization': `Bearer ${this.apiKey}`,
					'Content-Type': 'application/json',
				},
				timeout: 30000,
			}
		);

		const content = response.data.choices?.[0]?.message?.content ?? '';
		const jsonText = content.trim().replace(/^```json\n?|```$/g, '');
		return JSON.parse(jsonText);
	}
}

class GroqProvider {
	private client: Groq;
	private model: string;

	constructor(apiKey: string, model: string = 'llama-3.1-8b-instant') {
		this.client = new Groq({ apiKey });
		this.model = model;
	}

	async analyze(prompt: string): Promise<any> {
		const response = await this.client.chat.completions.create({
			model: this.model,
			messages: [
				{ role: 'system', content: 'Return ONLY valid JSON. No prose outside JSON.' },
				{ role: 'user', content: prompt },
			],
			temperature: 0.3,
		});

		const content = response.choices?.[0]?.message?.content ?? '';
		const jsonText = content.trim().replace(/^```json\n?|```$/g, '');
		return JSON.parse(jsonText);
	}
}

// Provider factory
export class AIProviderFactory {
	static createProvider(config: AIProviderConfig): OpenAIProvider | DeepSeekProvider | GroqProvider {
		switch (config.provider) {
			case 'openai':
				return new OpenAIProvider(config.apiKey, config.model);
			case 'deepseek':
				return new DeepSeekProvider(config.apiKey, config.model);
			case 'groq':
				return new GroqProvider(config.apiKey, config.model);
			default:
				throw new Error(`Unsupported AI provider: ${config.provider}`);
		}
	}
}

// Configuration detection
export function detectAIProvider(): AIProviderConfig {
	// Priority order: Groq > DeepSeek > OpenAI (based on cost-effectiveness)
	if (process.env.GROQ_API_KEY) {
		return {
			provider: 'groq',
			apiKey: process.env.GROQ_API_KEY,
			model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant'
		};
	}
	
	if (process.env.DEEPSEEK_API_KEY) {
		return {
			provider: 'deepseek',
			apiKey: process.env.DEEPSEEK_API_KEY,
			model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
		};
	}
	
	if (process.env.OPENAI_API_KEY) {
		return {
			provider: 'openai',
			apiKey: process.env.OPENAI_API_KEY,
			model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
		};
	}
	
	throw new Error('No AI provider API key found. Please set GROQ_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY');
}

// Enhanced prompt for better results across different models
export function buildEnhancedPrompt(article: Article, translateToPersian: boolean = true): string {
	const articleTitle = article.title;
	const articleText = article.contentSnippet;
	
	if (translateToPersian) {
		return `You are an expert AI analyst for "The AI Pipeline," a premium service for business professionals and product managers.

ARTICLE TITLE: ${articleTitle}
ARTICLE TEXT: ${articleText}

Analyze this article and provide a JSON object with EXACTLY these keys, ALL CONTENT IN PERSIAN:
{
  "tldr": "یک جمله جذاب که خلاصه خبر اصلی را ارائه دهد",
  "bullets": ["اولین نکته کلیدی", "دومین نکته کلیدی", "سومین نکته کلیدی"],
  "business_implication": "توضیح واضح تأثیر کسب‌وکار/بازار - فقط در صورت وجود تأثیر معنادار کسب‌وکار، در غیر این صورت رشته خالی",
  "target_audience": "متخصصان خاصی که این موضوع برای آنها مرتبط است",
  "description": "توضیح جذاب 2-3 جمله‌ای برای رسانه‌های اجتماعی که اهمیت موضوع را برجسته کند",
  "hashtags": ["هوش_مصنوعی", "اخبار_فناوری", "نوآوری", "کسب_وکار", "برچسب‌های", "مرتبط", "اضافی"]
}

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON, no extra text
- ALL content must be in Persian (Farsi)
- Description must be 2-3 sentences, engaging and newsworthy in Persian
- Include 6-8 hashtags in Persian without # symbols
- Focus on business impact and practical implications
- Use clear, professional Persian language
- Bullets must be exactly 3 items in Persian
- Make it compelling for Persian-speaking business professionals
- business_implication: ONLY include if there's a clear, actionable business impact that affects revenue, costs, or strategy. Use empty string ("") for minor updates
- INCLUDE business_implication for: major product launches, pricing changes, acquisitions, funding, policy changes, partnerships, layoffs/hiring, revenue reports
- SKIP business_implication for: bug fixes, minor features, version releases, tutorials, research papers, reviews, entertainment

Example Persian hashtags: هوش_مصنوعی, اخبار_فناوری, نوآوری, کسب_وکار, استارتاپ, مدیریت_محصول, یادگیری_ماشین, اتوماسیون, تحول_دیجیتال`;
	}
	
	return `You are an expert AI analyst for "The AI Pipeline," a premium service for business professionals and product managers.

ARTICLE TITLE: ${articleTitle}
ARTICLE TEXT: ${articleText}

Analyze this article and provide a JSON object with EXACTLY these keys:
{
  "tldr": "A single, compelling sentence that captures the core news",
  "bullets": ["First key insight", "Second key insight", "Third key insight"],
  "business_implication": "Clear explanation of business/market impact - ONLY if there's a meaningful business impact, otherwise empty string",
  "target_audience": "Specific professionals who would find this relevant",
  "description": "Engaging 2-3 sentence social media description that highlights why this matters",
  "hashtags": ["AI", "TechNews", "Innovation", "Business", "additional", "relevant", "tags"]
}

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON, no extra text
- Description must be 2-3 sentences, engaging and newsworthy
- Include 6-8 hashtags without # symbols
- Focus on business impact and practical implications
- Use clear, professional language
- Bullets must be exactly 3 items
- Make it compelling for business professionals
- business_implication: ONLY include if there's a clear, actionable business impact that affects revenue, costs, or strategy. Use empty string ("") for minor updates, bug fixes, feature updates, or general news
- INCLUDE business_implication for: major product launches, pricing changes, acquisition announcements, funding rounds, policy changes affecting businesses, significant partnerships, layoffs/hiring, revenue reports
- SKIP business_implication for: bug fixes, minor feature updates, version releases, technical tutorials, research papers, reviews, entertainment content, general tech news without clear commercial impact

Example hashtags: AI, TechNews, Innovation, Business, Startup, ProductManagement, MachineLearning, Automation, DigitalTransformation`;
}
