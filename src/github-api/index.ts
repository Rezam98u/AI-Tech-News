import axios from 'axios';
import { logger } from '../logger';

export interface GitHubRepo {
	name: string;
	fullName: string;
	description: string;
	htmlUrl: string;
	stars: number;
	language: string;
	topics: string[];
	createdAt: string;
	updatedAt: string;
	owner: {
		login: string;
		avatarUrl: string;
	};
}

export interface TrendingRepo extends GitHubRepo {
	trendingScore: number;
	weeklyStars: number;
}

// GitHub API configuration
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Optional, increases rate limit

const apiClient = axios.create({
	baseURL: GITHUB_API_BASE,
	headers: {
		'Accept': 'application/vnd.github.v3+json',
		'User-Agent': 'AI-Tech-News-Bot/1.0',
		...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
	}
});

// AI/ML related topics and keywords
const AI_ML_TOPICS = [
	'artificial-intelligence',
	'machine-learning',
	'deep-learning',
	'neural-network',
	'pytorch',
	'tensorflow',
	'openai',
	'gpt',
	'llm',
	'large-language-model',
	'prompt-engineering',
	'chatgpt',
	'langchain',
	'vector-database',
	'embeddings',
	'nlp',
	'computer-vision',
	'generative-ai',
	'stable-diffusion',
	'midjourney',
	'claude',
	'gemini',
	'ollama',
	'rag',
	'retrieval-augmented-generation'
];

const AI_ML_KEYWORDS = [
	'ai', 'ml', 'llm', 'gpt', 'openai', 'pytorch', 'tensorflow',
	'neural', 'deep learning', 'machine learning', 'nlp', 'cv',
	'prompt', 'embedding', 'vector', 'rag', 'langchain'
];

/**
 * Search for trending repositories with AI/ML focus
 */
export async function searchTrendingRepos(options?: {
	language?: string;
	sort?: 'stars' | 'updated' | 'created';
	order?: 'desc' | 'asc';
	perPage?: number;
	days?: number;
}): Promise<TrendingRepo[]> {
	try {
		const {
			language = '',
			sort = 'stars',
			order = 'desc',
			perPage = 30,
			days = 7
		} = options || {};

		// Build search query for AI/ML repositories with more flexible criteria
		const queryParts = [
			'pushed:>' + new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Use pushed instead of created for more recent activity
			'stars:>5', // Lower minimum stars to find more repositories
		];

		// Add AI/ML keywords to the search query instead of just topics
		const aiKeywords = ['ai', 'machine-learning', 'deep-learning', 'neural-network', 'pytorch', 'tensorflow', 'llm', 'gpt', 'openai', 'langchain'];
		queryParts.push(`(${aiKeywords.join(' OR ')})`);

		if (language) {
			queryParts.push(`language:${language}`);
		}

		const query = queryParts.join(' ');
		
		logger.info({ query, perPage }, 'Searching GitHub for trending AI/ML repos');

		const response = await apiClient.get('/search/repositories', {
			params: {
				q: query,
				sort,
				order,
				per_page: perPage
			}
		});

		const repos: TrendingRepo[] = response.data.items.map((repo: any) => ({
			name: repo.name,
			fullName: repo.full_name,
			description: repo.description || 'No description available',
			htmlUrl: repo.html_url,
			stars: repo.stargazers_count,
			language: repo.language || 'Unknown',
			topics: repo.topics || [],
			createdAt: repo.created_at,
			updatedAt: repo.updated_at,
			owner: {
				login: repo.owner.login,
				avatarUrl: repo.owner.avatar_url
			},
			trendingScore: calculateTrendingScore(repo),
			weeklyStars: 0 // Would need additional API calls to calculate
		}));

		// Filter and score repositories
		const filteredRepos = repos
			.filter(repo => isAI_ML_Related(repo))
			.sort((a, b) => b.trendingScore - a.trendingScore)
			.slice(0, 10); // Top 10 trending

		logger.info({ 
			found: repos.length, 
			filtered: filteredRepos.length 
		}, 'GitHub trending repos processed');

		return filteredRepos;

	} catch (error) {
		logger.error({ 
			error: error instanceof Error ? error.message : String(error) 
		}, 'Failed to fetch trending GitHub repos');
		
		// Try a simpler search as fallback
		try {
			const simpleQuery = 'stars:>100 ai OR machine-learning OR deep-learning OR pytorch OR tensorflow OR llm OR gpt';
			const response = await apiClient.get('/search/repositories', {
				params: {
					q: simpleQuery,
					sort: 'stars',
					order: 'desc',
					per_page: 10
				}
			});

			const repos: TrendingRepo[] = response.data.items.map((repo: any) => ({
				name: repo.name,
				fullName: repo.full_name,
				description: repo.description || 'No description available',
				htmlUrl: repo.html_url,
				stars: repo.stargazers_count,
				language: repo.language || 'Unknown',
				topics: repo.topics || [],
				createdAt: repo.created_at,
				updatedAt: repo.updated_at,
				owner: {
					login: repo.owner.login,
					avatarUrl: repo.owner.avatar_url
				},
				trendingScore: calculateTrendingScore(repo),
				weeklyStars: 0
			}));

			const filteredRepos = repos
				.filter(repo => isAI_ML_Related(repo))
				.sort((a, b) => b.trendingScore - a.trendingScore)
				.slice(0, 10);

			if (filteredRepos.length > 0) {
				logger.info({ found: filteredRepos.length }, 'Found repos with fallback search');
				return filteredRepos;
			}
		} catch (fallbackError) {
			logger.warn({ error: fallbackError }, 'Fallback search also failed');
		}
		
		// Return static fallback data as last resort
		return getFallbackTrendingRepos();
	}
}

/**
 * Check if a repository is AI/ML related
 */
function isAI_ML_Related(repo: GitHubRepo): boolean {
	const textToCheck = [
		repo.name,
		repo.description,
		repo.fullName,
		...repo.topics
	].join(' ').toLowerCase();

	// Check for AI/ML keywords
	const hasKeywords = AI_ML_KEYWORDS.some(keyword => 
		textToCheck.includes(keyword.toLowerCase())
	);

	// Check for AI/ML topics
	const hasTopics = repo.topics.some(topic => 
		AI_ML_TOPICS.includes(topic.toLowerCase())
	);

	return hasKeywords || hasTopics;
}

/**
 * Calculate trending score based on stars, recency, and activity
 */
function calculateTrendingScore(repo: any): number {
	const stars = repo.stargazers_count || 0;
	const createdAt = new Date(repo.created_at);
	const updatedAt = new Date(repo.updated_at);
	const now = new Date();

	// Recency factor (newer repos get higher scores)
	const daysSinceCreated = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
	const daysSinceUpdated = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);

	const recencyScore = Math.max(0, 30 - daysSinceCreated) + Math.max(0, 7 - daysSinceUpdated);
	const starScore = Math.log10(stars + 1) * 10; // Logarithmic scaling for stars

	return starScore + recencyScore;
}

/**
 * Get fallback trending repos when API fails
 */
function getFallbackTrendingRepos(): TrendingRepo[] {
	return [
		{
			name: 'langchain',
			fullName: 'langchain-ai/langchain',
			description: 'Building applications with LLMs through composability',
			htmlUrl: 'https://github.com/langchain-ai/langchain',
			stars: 85000,
			language: 'Python',
			topics: ['llm', 'langchain', 'ai', 'machine-learning'],
			createdAt: '2022-10-17T00:00:00Z',
			updatedAt: new Date().toISOString(),
			owner: { login: 'langchain-ai', avatarUrl: 'https://github.com/langchain-ai.png' },
			trendingScore: 95,
			weeklyStars: 500
		},
		{
			name: 'ollama',
			fullName: 'ollama/ollama',
			description: 'Get up and running with large language models locally',
			htmlUrl: 'https://github.com/ollama/ollama',
			stars: 45000,
			language: 'Go',
			topics: ['llm', 'ai', 'local', 'machine-learning'],
			createdAt: '2023-03-15T00:00:00Z',
			updatedAt: new Date().toISOString(),
			owner: { login: 'ollama', avatarUrl: 'https://github.com/ollama.png' },
			trendingScore: 90,
			weeklyStars: 300
		}
	];
}

/**
 * Format repository for Telegram display
 */
export function formatRepoForTelegram(repo: TrendingRepo, index: number): string {
	const stars = repo.stars.toLocaleString();
	const language = repo.language || 'Unknown';
	const topics = repo.topics.slice(0, 3).map(t => `#${t}`).join(' ');
	
	return `**${index + 1}. [${repo.name}](https://github.com/${repo.fullName})**
👤 ${repo.owner.login} • ⭐ ${stars} • 🔧 ${language}
📝 ${repo.description}

${topics ? `🏷️ ${topics}` : ''}

`;
}

/**
 * Get trending repos formatted for Telegram
 */
export async function getTrendingReposForTelegram(): Promise<string> {
	try {
		const repos = await searchTrendingRepos({ perPage: 8 });
		
		if (repos.length === 0) {
			return '🚫 No trending AI/ML repositories found at the moment.';
		}

		let message = '🔥 **Trending AI/ML Repositories**\n\n';
		
		repos.forEach((repo, index) => {
			message += formatRepoForTelegram(repo, index);
		});

		message += '\n💡 *Updated every hour*';
		
		return message;

	} catch (error) {
		logger.error({ error }, 'Failed to get trending repos for Telegram');
		return '❌ Failed to fetch trending repositories. Please try again later.';
	}
}
