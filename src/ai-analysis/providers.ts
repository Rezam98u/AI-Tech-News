import OpenAI from 'openai';
import Groq from 'groq-sdk';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { HfInference } from '@huggingface/inference';
import { Article } from '../types';
import { cleanAIResponse, sanitizeAIJsonResponse } from '../utils/sanitizer';
import { logger } from '../logger';

export type AIProvider = 'openai' | 'deepseek' | 'groq' | 'gemini' | 'huggingface';

export interface AIProviderConfig {
	provider: AIProvider;
	apiKey: string;
	model?: string;
}

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
		const cleaned = cleanAIResponse(content);
		return sanitizeAIJsonResponse(cleaned);
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
		const cleaned = cleanAIResponse(content);
		return sanitizeAIJsonResponse(cleaned);
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
		const cleaned = cleanAIResponse(content);
		return sanitizeAIJsonResponse(cleaned);
	}
}

class GeminiProvider {
	private client: GoogleGenerativeAI;
	private model: string;

	constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
		this.client = new GoogleGenerativeAI(apiKey);
		this.model = model;
	}

	async analyze(prompt: string): Promise<any> {
		const model = this.client.getGenerativeModel({ model: this.model });
		
		const result = await model.generateContent({
			contents: [{
				role: 'user',
				parts: [{
					text: 'You are an AI analyst. Return ONLY valid JSON. No prose outside JSON.\n\n' + prompt
				}]
			}],
			generationConfig: {
				temperature: 0.3,
			}
		});
		
		const response = await result.response;
		const content = response.text();
		const cleaned = cleanAIResponse(content);
		return sanitizeAIJsonResponse(cleaned);
	}
}

class HuggingFaceProvider {
	private client: HfInference;
	private model: string;

	constructor(apiKey: string, model: string = 'meta-llama/Meta-Llama-3-8B-Instruct') {
		this.client = new HfInference(apiKey);
		this.model = model;
	}

	async analyze(prompt: string): Promise<any> {
		const systemPrompt = 'You are an AI analyst. Return ONLY valid JSON. No prose outside JSON.';
		
		let response = '';
		for await (const chunk of this.client.chatCompletionStream({
			model: this.model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: prompt }
			],
			max_tokens: 1500,
			temperature: 0.3,
		})) {
			if (chunk.choices?.[0]?.delta?.content) {
				response += chunk.choices[0].delta.content;
			}
		}
		
		const cleaned = cleanAIResponse(response);
		return sanitizeAIJsonResponse(cleaned);
	}
}

export class AIProviderFactory {
	static createProvider(config: AIProviderConfig): OpenAIProvider | DeepSeekProvider | GroqProvider | GeminiProvider | HuggingFaceProvider {
		switch (config.provider) {
			case 'openai':
				return new OpenAIProvider(config.apiKey, config.model);
			case 'deepseek':
				return new DeepSeekProvider(config.apiKey, config.model);
			case 'groq':
				return new GroqProvider(config.apiKey, config.model);
			case 'gemini':
				return new GeminiProvider(config.apiKey, config.model);
			case 'huggingface':
				return new HuggingFaceProvider(config.apiKey, config.model);
			default:
				throw new Error(`Unsupported AI provider: ${config.provider}`);
		}
	}
}

export function detectAIProvider(): AIProviderConfig {
	// Check if AI_PROVIDER is explicitly set
	const explicitProvider = process.env.AI_PROVIDER as AIProvider | undefined;
	
	if (explicitProvider) {
		switch (explicitProvider) {
			case 'gemini':
				if (process.env.GEMINI_API_KEY) {
					return {
						provider: 'gemini',
						apiKey: process.env.GEMINI_API_KEY,
						model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
					};
				}
				break;
			case 'huggingface':
				if (process.env.HUGGINGFACE_API_KEY) {
					return {
						provider: 'huggingface',
						apiKey: process.env.HUGGINGFACE_API_KEY,
						model: process.env.HUGGINGFACE_MODEL || 'meta-llama/Meta-Llama-3-8B-Instruct'
					};
				}
				break;
			case 'groq':
				if (process.env.GROQ_API_KEY) {
					return {
						provider: 'groq',
						apiKey: process.env.GROQ_API_KEY,
						model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
					};
				}
				break;
			case 'deepseek':
				if (process.env.DEEPSEEK_API_KEY) {
					return {
						provider: 'deepseek',
						apiKey: process.env.DEEPSEEK_API_KEY,
						model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
					};
				}
				break;
			case 'openai':
				if (process.env.OPENAI_API_KEY) {
					return {
						provider: 'openai',
						apiKey: process.env.OPENAI_API_KEY,
						model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
					};
				}
				break;
		}
	}
	
	// Fallback to priority order
	if (process.env.GROQ_API_KEY) {
		return {
			provider: 'groq',
			apiKey: process.env.GROQ_API_KEY,
			model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
		};
	}
	
	if (process.env.GEMINI_API_KEY) {
		return {
			provider: 'gemini',
			apiKey: process.env.GEMINI_API_KEY,
			model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
		};
	}
	
	if (process.env.DEEPSEEK_API_KEY) {
		return {
			provider: 'deepseek',
			apiKey: process.env.DEEPSEEK_API_KEY,
			model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
		};
	}
	
	if (process.env.HUGGINGFACE_API_KEY) {
		return {
			provider: 'huggingface',
			apiKey: process.env.HUGGINGFACE_API_KEY,
			model: process.env.HUGGINGFACE_MODEL || 'meta-llama/Meta-Llama-3-8B-Instruct'
		};
	}
	
	if (process.env.OPENAI_API_KEY) {
		return {
			provider: 'openai',
			apiKey: process.env.OPENAI_API_KEY,
			model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
		};
	}
	
	throw new Error('No AI provider API key found. Please set GROQ_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, HUGGINGFACE_API_KEY, or OPENAI_API_KEY');
}

export function isRedditPost(article: Article): boolean {
	return article.link.includes('reddit.com');
}

function getSubreddit(link: string): string {
	const match = link.match(/reddit\.com\/r\/([^\/]+)/);
	return match ? match[1]! : 'reddit';
}

function buildRedditPrompt(article: Article): string {
	const articleTitle = article.title;
	const articleText = article.contentSnippet;
	const subreddit = getSubreddit(article.link);
	
	let context = `REDDIT POST TITLE: ${articleTitle}\n`;
	context += `POST CONTENT: ${articleText}\n`;
	
	if (article.description) {
		context += `\nPOST BODY (SELFTEXT): ${article.description}\n`;
	}
	
	if (article.linkedContent) {
		context += `\nLINKED EXTERNAL CONTENT: ${article.linkedContent}\n`;
	}
	
	return `You are an AI content analyzer for Reddit posts from r/${subreddit}.

${context}

Create a JSON object with EXACTLY these keys:
{
  "tldr": "Clear one-sentence summary of the main point",
  "bullets": ["Specific detail or insight 1", "Different actionable point 2", "Unique takeaway or statistic 3"],
  "business_implication": "Business/career relevance - ONLY if applicable, otherwise empty string",
  "target_audience": "Specific professionals/roles who would benefit",
  "description": "Engaging explanation that ADDS NEW CONTEXT beyond the title and bullets",
  "hashtags": ["relevant", "tags", "for", "topic"]
}

TL;DR INSTRUCTIONS:
✅ If the title is clear and concise, use it as-is: "${articleTitle}"
✅ If the title is unclear, overly long (>100 chars), or uses excessive punctuation/formatting, rephrase it to be clearer
✅ Always preserve the CORE INTENT and main message of the original title
✅ Make it compelling and scannable while being accurate
✅ Example transformation: "🚀🚀 HUGE NEWS!!! This will change everything about AI coding (you won't believe what happened)" → "AI coding tool launches with breakthrough features"

CRITICAL ANTI-REPETITION RULES:
❌ DO NOT repeat the same information across sections
❌ DO NOT use generic phrases like "stay ahead", "latest development", "significant impact"
❌ DO NOT restate the title in bullets or description
✅ Each bullet MUST present a DIFFERENT specific detail, insight, or actionable point
✅ Description MUST add NEW context, implications, or WHY this matters (not WHAT it is)
✅ Make bullets concrete with numbers, names, specific features, or unique insights
✅ Description should focus on: implications, who benefits, why it matters NOW, or what's unique

CONTENT PRIORITIZATION:
- Use POST BODY and LINKED EXTERNAL CONTENT for detailed insights in bullets
- Extract concrete details: numbers, pricing, features, partnerships, timelines
- Summarize linked articles/content to provide context beyond just the Reddit title

REQUIREMENTS:
- Return ONLY valid JSON, no extra text
- tldr: Original title OR rephrased if unclear/long (always preserving core intent)
- Bullets: 3 DISTINCT specific points from post body and linked content
- Description: 2-3 sentences adding NEW perspective or context
- Include 4-6 relevant hashtags without # symbols
- business_implication: Only if clear career/income/business impact exists
- Make it scannable and valuable - each section serves unique purpose

Example good bullets (specific & distinct):
✅ "Launched with $5M Series A from Sequoia Capital"
✅ "Free tier supports up to 10K API calls/month"
✅ "Compatible with existing React and Vue projects"

Example bad bullets (generic & repetitive):
❌ "This is a significant development in AI"
❌ "Expected to have major impact on businesses"
❌ "Represents an important advancement in the field"`;
}

export function buildEnhancedPrompt(article: Article): string {
	if (isRedditPost(article)) {
		return buildRedditPrompt(article);
	}
	
	const articleTitle = article.title;
	const articleText = article.contentSnippet;
	
	return `You are an expert AI analyst for "The AI Pipeline," a premium service for business professionals and product managers.

ARTICLE TITLE: ${articleTitle}
ARTICLE TEXT: ${articleText}

Analyze this article and provide a JSON object with EXACTLY these keys:
{
  "tldr": "One compelling sentence capturing the MAIN news (not restating the title)",
  "bullets": ["Specific detail/metric 1", "Different concrete insight 2", "Unique implication/fact 3"],
  "business_implication": "Specific business/market impact - ONLY if meaningful, otherwise empty string",
  "target_audience": "Specific job roles/industries who would benefit",
  "description": "Engaging 2-3 sentences that ADD NEW CONTEXT and explain WHY this matters",
  "hashtags": ["AI", "TechNews", "Innovation", "Business", "RelevantTag", "SpecificTag"]
}

CRITICAL ANTI-REPETITION RULES:
❌ DO NOT repeat the same information in TLDR, bullets, and description
❌ DO NOT use generic phrases: "stay ahead", "latest development", "significant impact", "major advancement"
❌ DO NOT just rephrase the title - extract the core NEWS
❌ DO NOT make bullets that say the same thing in different words
✅ TLDR: Extract the single most important FACT or ANNOUNCEMENT
✅ Bullets: 3 DIFFERENT specific details (numbers, features, implications, stakeholders affected)
✅ Description: Add CONTEXT - why now, who benefits, what changes, market implications
✅ Each section must serve a UNIQUE purpose and add NEW information

REQUIREMENTS:
- Return ONLY valid JSON, no extra text
- TLDR: One sentence with the core news/announcement (different angle from title)
- Bullets: 3 DISTINCT specific points (with numbers, names, features, or data when available)
- Description: 2-3 sentences adding strategic context beyond TLDR and bullets
- Include 4-6 hashtags without # symbols
- business_implication: ONLY for major launches, pricing changes, acquisitions, funding, policy changes, partnerships, layoffs/hiring, revenue reports
- SKIP business_implication for: bug fixes, minor updates, tutorials, research papers, general news
- Make each section valuable on its own - no filler content

Example GOOD structure:
TLDR: "OpenAI launches GPT-5 with 10x faster processing and multimodal capabilities"
Bullets:
  • "Pricing starts at $20/month for Pro tier with 500 queries/day"
  • "New vision API can analyze video in real-time at 60fps"
  • "Early access partners include Microsoft, Salesforce, and Adobe"
Description: "This release positions OpenAI ahead of Google's Gemini in enterprise adoption. The real-time video analysis opens new use cases in security, healthcare diagnostics, and quality control manufacturing."

Example BAD structure (repetitive):
TLDR: "OpenAI announces major AI update"
Bullets:
  • "OpenAI has released a significant update to their AI"
  • "This update includes important improvements"
  • "The advancement is expected to impact businesses"
Description: "OpenAI's latest announcement represents a major development in AI technology that will have significant implications for businesses and professionals."

Example hashtags: AI, OpenAI, TechNews, Enterprise, MachineLearning, Innovation`;
}

// Provider health tracking
interface ProviderHealth {
	provider: AIProvider;
	lastFailure?: number;
	failureCount: number;
	isHealthy: boolean;
	lastSuccess?: number;
}

const providerHealth: Map<AIProvider, ProviderHealth> = new Map();

// Initialize provider health tracking
function initializeProviderHealth(): void {
	const providers: AIProvider[] = ['groq', 'gemini', 'deepseek', 'huggingface', 'openai'];
	providers.forEach(provider => {
		providerHealth.set(provider, {
			provider,
			failureCount: 0,
			isHealthy: true
		});
	});
}

// Track provider failure
function trackProviderFailure(provider: AIProvider, _error: Error): void {
	const health = providerHealth.get(provider);
	if (health) {
		health.lastFailure = Date.now();
		health.failureCount++;
		
		// Mark as unhealthy if too many failures
		if (health.failureCount >= 3) {
			health.isHealthy = false;
		}
	}
}

// Track provider success
function trackProviderSuccess(provider: AIProvider): void {
	const health = providerHealth.get(provider);
	if (health) {
		health.lastSuccess = Date.now();
		health.failureCount = 0;
		health.isHealthy = true;
	}
}

// Check if provider should be retried (after cooldown period)
function shouldRetryProvider(provider: AIProvider): boolean {
	const health = providerHealth.get(provider);
	if (!health) return true;
	
	// If healthy, always retry
	if (health.isHealthy) return true;
	
	// If unhealthy, check cooldown period (5 minutes)
	const cooldownPeriod = 5 * 60 * 1000; // 5 minutes
	const timeSinceFailure = health.lastFailure ? Date.now() - health.lastFailure : Infinity;
	
	return timeSinceFailure > cooldownPeriod;
}

// Get available providers in order of preference
function getAvailableProviders(article: Article, category?: string): AIProviderConfig[] {
	const isReddit = isRedditPost(article);
	const contentLength = (article.contentSnippet?.length || 0) + (article.description?.length || 0) + (article.linkedContent?.length || 0);
	
	// Provider strengths for different scenarios
	const providerPreferences: Record<string, AIProvider[]> = {
		// Reddit posts with external links - best with reasoning models
		'reddit-with-content': ['groq', 'gemini', 'deepseek', 'openai', 'huggingface'],
		
		// Tech news & business - best with fast, accurate models
		'tech-news': ['groq', 'gemini', 'deepseek', 'openai', 'huggingface'],
		
		// AI Tools - benefit from creative descriptions
		'ai-tool': ['gemini', 'groq', 'deepseek', 'openai', 'huggingface'],
		
		// Business use cases - need good reasoning
		'business': ['deepseek', 'gemini', 'groq', 'openai', 'huggingface'],
		
		// Developer content - technical accuracy important
		'developer': ['deepseek', 'groq', 'gemini', 'openai', 'huggingface'],
		
		// Long content - models good with context
		'long-content': ['gemini', 'deepseek', 'groq', 'openai', 'huggingface'],
		
		// Default fallback
		'default': ['groq', 'gemini', 'deepseek', 'huggingface', 'openai']
	};
	
	// Determine scenario
	let scenario: string;
	
	if (isReddit && (article.linkedContent || article.description)) {
		scenario = 'reddit-with-content';
	} else if (contentLength > 2000) {
		scenario = 'long-content';
	} else if (category) {
		switch (category.toLowerCase()) {
			case 'tech news':
				scenario = 'tech-news';
				break;
			case 'ai tool':
				scenario = 'ai-tool';
				break;
			case 'business use-case':
				scenario = 'business';
				break;
			case 'developer prompts':
				scenario = 'developer';
				break;
			default:
				scenario = 'default';
		}
	} else {
		scenario = 'default';
	}
	
	// Get preferences for this scenario
	const preferences = providerPreferences[scenario] || providerPreferences['default'] || [];
	
	// Filter to only available and healthy providers
	const availableProviders: AIProviderConfig[] = [];
	
	for (const provider of preferences) {
		// Check if provider should be retried
		if (!shouldRetryProvider(provider)) {
			continue;
		}
		
		let apiKey: string | undefined;
		let model: string | undefined;
		
		switch (provider) {
			case 'groq':
				apiKey = process.env.GROQ_API_KEY;
				model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
				break;
			case 'gemini':
				apiKey = process.env.GEMINI_API_KEY;
				model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
				break;
			case 'deepseek':
				apiKey = process.env.DEEPSEEK_API_KEY;
				model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
				break;
			case 'huggingface':
				apiKey = process.env.HUGGINGFACE_API_KEY;
				model = process.env.HUGGINGFACE_MODEL || 'meta-llama/Meta-Llama-3-8B-Instruct';
				break;
			case 'openai':
				apiKey = process.env.OPENAI_API_KEY;
				model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
				break;
		}
		
		if (apiKey) {
			availableProviders.push({ provider, apiKey, model });
		}
	}
	
	return availableProviders;
}

/**
 * Get provider health status for monitoring
 */
export function getProviderHealthStatus(): Record<AIProvider, ProviderHealth> {
	const status: Record<AIProvider, ProviderHealth> = {} as any;
	
	for (const [provider, health] of providerHealth.entries()) {
		status[provider] = { ...health };
	}
	
	return status;
}

/**
 * Reset provider health (useful for testing or manual recovery)
 */
export function resetProviderHealth(provider?: AIProvider): void {
	if (provider) {
		const health = providerHealth.get(provider);
		if (health) {
			health.failureCount = 0;
			health.isHealthy = true;
			delete health.lastFailure;
		}
	} else {
		// Reset all providers
		initializeProviderHealth();
	}
}

/**
 * Enhanced analysis with automatic provider fallback and retry logic
 */
export async function analyzeWithFallback(
	article: Article, 
	category?: string,
	options?: {
		maxRetries?: number;
		retryDelay?: number;
		timeout?: number;
	}
): Promise<any> {
	const maxRetries = options?.maxRetries || 3;
	const retryDelay = options?.retryDelay || 1000;
	const timeout = options?.timeout || 30000;
	
	// Initialize provider health tracking
	initializeProviderHealth();
	
	const providers = getAvailableProviders(article, category);
	
	if (providers.length === 0) {
		throw new Error('No AI providers available. Please check your API keys.');
	}
	
	let lastError: Error | null = null;
	
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		for (const providerConfig of providers) {
			try {
				logger.info({ 
					provider: providerConfig.provider,
					model: providerConfig.model,
					attempt: attempt + 1,
					title: article.title.substring(0, 50)
				}, 'Using AI provider for analysis');
				
				const provider = AIProviderFactory.createProvider(providerConfig);
				const prompt = buildEnhancedPrompt(article);
				
				// Add timeout to the analysis
				const analysisPromise = provider.analyze(prompt);
				const timeoutPromise = new Promise((_, reject) => 
					setTimeout(() => reject(new Error('Analysis timeout')), timeout)
				);
				
				const result = await Promise.race([analysisPromise, timeoutPromise]);
				
				// Track successful analysis
				trackProviderSuccess(providerConfig.provider);
				
				logger.info({ 
					provider: providerConfig.provider,
					attempt: attempt + 1,
					title: article.title.substring(0, 50)
				}, 'AI analysis completed successfully');
				
				return result;
				
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				lastError = error;
				
				// Check if it's a quota/rate limit error
				const isQuotaError = error.message.includes('402') || 
									error.message.includes('quota') || 
									error.message.includes('rate limit') ||
									error.message.includes('429') ||
									error.message.includes('insufficient_quota');
				
				// Track provider failure
				trackProviderFailure(providerConfig.provider, error);
				
				logger.warn({ 
					provider: providerConfig.provider,
					error: error.message,
					isQuotaError,
					attempt: attempt + 1,
					title: article.title.substring(0, 50)
				}, 'AI provider failed, trying next provider');
				
				// If it's a quota error, don't retry this provider immediately
				if (isQuotaError) {
					continue; // Try next provider
				}
				
				// For other errors, continue to next provider
				continue;
			}
		}
		
		// If we've tried all providers and still failed, wait before retry
		if (attempt < maxRetries - 1) {
			logger.info({ 
				attempt: attempt + 1,
				maxRetries,
				delay: retryDelay,
				title: article.title.substring(0, 50)
			}, 'All providers failed, waiting before retry');
			
			await new Promise(resolve => setTimeout(resolve, retryDelay));
		}
	}
	
	// All providers failed
	logger.error({ 
		title: article.title.substring(0, 50),
		totalAttempts: maxRetries * providers.length,
		lastError: lastError?.message
	}, 'All AI providers failed after retries');
	
	throw new Error(`All AI providers failed: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Intelligent provider selection based on article type and content
 * This function analyzes the article and selects the best AI provider for optimal results
 */
export function selectProviderForArticle(article: Article, category?: string): AIProviderConfig {
	const providers = getAvailableProviders(article, category);
	
	if (providers.length === 0) {
		// Fallback to default detection
		return detectAIProvider();
	}
	
	// Return the first (preferred) provider
	return providers[0]!;
}
