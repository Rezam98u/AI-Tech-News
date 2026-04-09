export interface Article {
	title: string;
	link: string;
	contentSnippet: string;
	pubDate: string; // ISO 8601 string
	/** When set (e.g. from Reddit feed config), used for templates and routing */
	category?: string;
	imageUrl?: string; // Optional image URL from the article
	description?: string; // Reddit post body/selftext
	linkedContent?: string; // Summary of external URL content (for Reddit posts)
	externalLink?: string; // The actual external URL from Reddit posts
	generatedImageBuffer?: Buffer; // Generated image buffer (for articles without images)
	isGeneratedImage?: boolean; // Flag to indicate if image was generated
}

export interface AnalysisResult {
	tldr: string;
	bullets: string[]; // exactly 3 items preferred
	business_implication: string;
	target_audience: string;
	description: string; // AI-generated description for social media
	hashtags: string[]; // Relevant hashtags
}


