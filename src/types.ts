export interface Article {
	title: string;
	link: string;
	contentSnippet: string;
	pubDate: string; // ISO 8601 string
	imageUrl?: string; // Optional image URL from the article
	description?: string; // Reddit post body/selftext
	linkedContent?: string; // Summary of external URL content (for Reddit posts)
	externalLink?: string; // The actual external URL from Reddit posts
}

export interface AnalysisResult {
	tldr: string;
	bullets: string[]; // exactly 3 items preferred
	business_implication: string;
	target_audience: string;
	description: string; // AI-generated description for social media
	hashtags: string[]; // Relevant hashtags
}


