export interface Article {
	title: string;
	link: string;
	contentSnippet: string;
	pubDate: string; // ISO 8601 string
}

export interface AnalysisResult {
	tldr: string;
	bullets: string[]; // exactly 3 items preferred
	business_implication: string;
	target_audience: string;
}


