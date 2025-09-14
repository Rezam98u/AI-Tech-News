import OpenAI from 'openai';
import { Article, AnalysisResult } from '../types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(article: Article): string {
	const articleTitle = article.title;
	const articleText = article.contentSnippet;
	return `
You are an analyst for "The AI Pipeline," a service for business professionals and product managers.

ARTICLE TITLE: ${articleTitle}
ARTICLE TEXT: ${articleText}

Analyze this article and provide a JSON object with the following keys:
- "tldr": (string) A one-sentence summary.
- "bullets": (string[]) An array of exactly 3 concise key takeaways.
- "business_implication": (string) Explain what this means for businesses, products, or the market.
- "target_audience": (string) Describe which professionals would find this most relevant.

Guidelines:
- Focus on product features, market shifts, and competitive dynamics.
- Be concise and insightful. Avoid fluff.
- Translate technical jargon into business impact.
`;
}

function coerceResult(obj: any): AnalysisResult {
	return {
		tldr: String(obj?.tldr ?? '').trim(),
		bullets: Array.isArray(obj?.bullets) ? obj.bullets.map((b: any) => String(b)) : [],
		business_implication: String(obj?.business_implication ?? '').trim(),
		target_audience: String(obj?.target_audience ?? '').trim(),
	};
}

export async function analyzeArticle(article: Article): Promise<AnalysisResult> {
	if (!process.env.OPENAI_API_KEY) {
		throw new Error('Missing OPENAI_API_KEY');
	}

	const prompt = buildPrompt(article);
	const response = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: 'Return ONLY valid JSON. No prose outside JSON.' },
			{ role: 'user', content: prompt },
		],
		temperature: 0.3,
	});

	const content = response.choices?.[0]?.message?.content ?? '';
	let parsed: any;
	try {
		const jsonText = content.trim().replace(/^```json\n?|```$/g, '');
		parsed = JSON.parse(jsonText);
	} catch (err) {
		parsed = {};
	}
	return coerceResult(parsed);
}


