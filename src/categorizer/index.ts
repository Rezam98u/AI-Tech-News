import { Article } from '../types';
import { logger } from '../logger';

export type ContentCategory = 'AI Tool' | 'Tech News' | 'Business Use-Case' | 'Job Opportunity' | 'Sponsored Deal';

interface CategoryKeywords {
	[key: string]: {
		primary: string[];
		secondary: string[];
		negative?: string[]; // Words that disqualify this category
	};
}

const CATEGORY_KEYWORDS: CategoryKeywords = {
	'AI Tool': {
		primary: ['launch', 'release', 'update', 'new', 'introduces', 'announces', 'unveils', 'launched', 'released'],
		secondary: [
			'app', 'tool', 'platform', 'plugin', 'extension', 'software', 'api', 'sdk',
			'chatbot', 'assistant', 'model', 'feature', 'version', 'beta', 'available',
			'integration', 'chrome extension', 'mobile app', 'web app', 'saas',
			'product hunt', 'future tools', 'ai tool', 'ai app', 'automation',
			'workflow', 'productivity', 'generator', 'creator', 'builder'
		],
		negative: ['discontinued', 'shutting down', 'deprecated']
	},
	'Tech News': {
		primary: [
			'acquires', 'acquisition', 'merges', 'merger', 'partnership', 'deal',
			'funding', 'investment', 'ipo', 'lawsuit', 'regulation', 'policy'
		],
		secondary: [
			'ceo', 'executive', 'layoffs', 'hiring', 'report', 'earnings', 'revenue',
			'stock', 'shares', 'valuation', 'billion', 'million', 'agreement',
			'google', 'microsoft', 'openai', 'meta', 'apple', 'amazon', 'nvidia'
		]
	},
	'Business Use-Case': {
		primary: [
			'case study', 'how we', 'how to', 'implemented', 'adopted', 'transformed',
			'improved', 'increased', 'reduced', 'automated', 'streamlined'
		],
		secondary: [
			'efficiency', 'productivity', 'costs', 'revenue', 'roi', 'workflow',
			'process', 'customer service', 'marketing', 'sales', 'hr', 'finance',
			'manufacturing', 'healthcare', 'education', 'retail', 'logistics'
		]
	},
	'Job Opportunity': {
		primary: [
			'hiring', 'job', 'position', 'career', 'freelance', 'contractor',
			'remote', 'work from home', 'opportunity', 'opening'
		],
		secondary: [
			'engineer', 'developer', 'scientist', 'researcher', 'analyst',
			'manager', 'director', 'specialist', 'consultant', 'intern',
			'ai engineer', 'ml engineer', 'data scientist', 'prompt engineer'
		]
	},
	'Sponsored Deal': {
		primary: [
			'discount', 'deal', 'offer', 'sale', 'promotion', 'coupon',
			'limited time', 'special offer', 'promo code', 'save'
		],
		secondary: [
			'% off', 'percent off', 'free trial', 'lifetime', 'bundle',
			'pricing', 'subscription', 'plan', 'upgrade', 'premium'
		]
	}
};

function normalizeText(text: string): string {
	return text.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function containsKeywords(text: string, keywords: string[]): number {
	const normalizedText = normalizeText(text);
	let score = 0;
	
	for (const keyword of keywords) {
		const normalizedKeyword = normalizeText(keyword);
		if (normalizedText.includes(normalizedKeyword)) {
			score++;
		}
	}
	
	return score;
}

export function categorizeArticle(article: Article): ContentCategory | null {
	const combinedText = `${article.title} ${article.contentSnippet}`;
	const scores: { [key in ContentCategory]: number } = {
		'AI Tool': 0,
		'Tech News': 0,
		'Business Use-Case': 0,
		'Job Opportunity': 0,
		'Sponsored Deal': 0
	};

	// Domain-based scoring boosts
	const domain = article.link ? new URL(article.link).hostname.toLowerCase() : '';
	if (domain.includes('huggingface.co') || domain.includes('blog.google')) {
		scores['AI Tool'] += 2; // Moderate boost for AI-focused tech blogs
	}

	// Calculate scores for each category
	for (const [categoryName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
		const category = categoryName as ContentCategory;
		
		// Check for negative keywords first (disqualifiers)
		if (keywords.negative && containsKeywords(combinedText, keywords.negative) > 0) {
			scores[category] = -10; // Heavy penalty
			continue;
		}
		
		// Primary keywords have higher weight
		const primaryScore = containsKeywords(combinedText, keywords.primary) * 3;
		
		// Secondary keywords have lower weight
		const secondaryScore = containsKeywords(combinedText, keywords.secondary) * 1;
		
		scores[category] += primaryScore + secondaryScore;
	}

	// Find the category with the highest score
	const bestCategory = Object.entries(scores).reduce((best, [category, score]) => {
		return score > best.score ? { category: category as ContentCategory, score } : best;
	}, { category: null as ContentCategory | null, score: 0 });

	// Require minimum score to categorize
	const minimumScore = 2;
	if (bestCategory.score >= minimumScore) {
		logger.debug({ 
			title: article.title, 
			category: bestCategory.category, 
			score: bestCategory.score,
			allScores: scores
		}, 'categorized article');
		return bestCategory.category;
	}

	logger.debug({ 
		title: article.title, 
		scores, 
		bestScore: bestCategory.score 
	}, 'article did not meet categorization threshold');
	
	return null;
}

export function filterArticlesByCategory(articles: Article[], targetCategory: ContentCategory): Article[] {
	const categorized = articles.filter(article => {
		const category = categorizeArticle(article);
		return category === targetCategory;
	});
	
	logger.info({ 
		total: articles.length, 
		filtered: categorized.length, 
		targetCategory 
	}, 'filtered articles by category');
	
	return categorized;
}

export function categorizeAllArticles(articles: Article[]): { [key in ContentCategory]: Article[] } {
	const categorized: { [key in ContentCategory]: Article[] } = {
		'AI Tool': [],
		'Tech News': [],
		'Business Use-Case': [],
		'Job Opportunity': [],
		'Sponsored Deal': []
	};

	for (const article of articles) {
		const category = categorizeArticle(article);
		if (category) {
			categorized[category].push(article);
		}
	}

	logger.info({ 
		total: articles.length,
		'AI Tool': categorized['AI Tool'].length,
		'Tech News': categorized['Tech News'].length,
		'Business Use-Case': categorized['Business Use-Case'].length,
		'Job Opportunity': categorized['Job Opportunity'].length,
		'Sponsored Deal': categorized['Sponsored Deal'].length,
		uncategorized: articles.length - Object.values(categorized).flat().length
	}, 'categorized all articles');

	return categorized;
}
