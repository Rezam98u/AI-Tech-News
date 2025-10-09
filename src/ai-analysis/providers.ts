import OpenAI from 'openai';
import Groq from 'groq-sdk';
import axios from 'axios';
import { Article } from '../types';
import { cleanAIResponse, sanitizeAIJsonResponse } from '../utils/sanitizer';

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

// Helper function to detect if article is from Reddit
export function isRedditPost(article: Article): boolean {
	return article.link.includes('reddit.com');
}

// Extract subreddit name from Reddit link
function getSubreddit(link: string): string {
	const match = link.match(/reddit\.com\/r\/([^\/]+)/);
	return match ? match[1]! : 'reddit';
}

// Reddit-specific prompt that keeps original title and summarizes description
function buildRedditPrompt(article: Article): string {
	const articleTitle = article.title;
	const articleText = article.contentSnippet;
	const subreddit = getSubreddit(article.link);
	
	return `You are an AI content analyzer for Reddit posts from r/${subreddit}.

REDDIT POST TITLE: ${articleTitle}
POST CONTENT: ${articleText}

Create a JSON object with EXACTLY these keys:
{
  "tldr": "${articleTitle}",
  "bullets": ["Specific detail or insight 1", "Different actionable point 2", "Unique takeaway or statistic 3"],
  "business_implication": "Business/career relevance - ONLY if applicable, otherwise empty string",
  "target_audience": "Specific professionals/roles who would benefit",
  "description": "Engaging explanation that ADDS NEW CONTEXT beyond the title and bullets",
  "hashtags": ["relevant", "tags", "for", "topic"]
}

CRITICAL ANTI-REPETITION RULES:
❌ DO NOT repeat the same information across sections
❌ DO NOT use generic phrases like "stay ahead", "latest development", "significant impact"
❌ DO NOT restate the title in bullets or description
✅ Each bullet MUST present a DIFFERENT specific detail, insight, or actionable point
✅ Description MUST add NEW context, implications, or WHY this matters (not WHAT it is)
✅ Make bullets concrete with numbers, names, specific features, or unique insights
✅ Description should focus on: implications, who benefits, why it matters NOW, or what's unique

REQUIREMENTS:
- Return ONLY valid JSON, no extra text
- tldr MUST be: "${articleTitle}" (exact original title)
- Bullets: 3 DISTINCT specific points (no overlapping information)
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

// Enhanced prompt for better results across different models
export function buildEnhancedPrompt(article: Article): string {
	// Use Reddit-specific prompt for Reddit posts
	if (isRedditPost(article)) {
		return buildRedditPrompt(article);
	}
	
	// Standard prompt for non-Reddit sources
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
