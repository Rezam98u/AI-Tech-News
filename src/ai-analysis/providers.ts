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
export function buildEnhancedPrompt(article: Article): string {
	const articleTitle = article.title;
	const articleText = article.contentSnippet;
	
	return `You are an expert AI analyst for "The AI Pipeline," a premium service for business professionals and product managers.

ARTICLE TITLE: ${articleTitle}
ARTICLE TEXT: ${articleText}

Analyze this article and provide a JSON object with EXACTLY these keys:
{
  "tldr": "A single, compelling sentence that captures the core news",
  "bullets": ["First key insight", "Second key insight", "Third key insight"],
  "business_implication": "Clear explanation of business/market impact",
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

Example hashtags: AI, TechNews, Innovation, Business, Startup, ProductManagement, MachineLearning, Automation, DigitalTransformation`;
}
