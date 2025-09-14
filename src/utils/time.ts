import { Article } from '../types';
import { logger } from '../logger';

function parseDateSafe(value: string): Date {
	try {
		const d = new Date(value);
		if (isNaN(d.getTime())) throw new Error('Invalid date');
		return d;
	} catch (err) {
		logger.debug({ value }, 'failed to parse date, using now');
		return new Date();
	}
}

export function getTimeAgo(isoDate: string): string {
	const date = parseDateSafe(isoDate);
	const now = new Date();
	const diffMs = Math.max(0, now.getTime() - date.getTime());
	const minutes = Math.floor(diffMs / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function filterByTimeRange(articles: Article[], hours: number): Article[] {
	const now = Date.now();
	const thresholdMs = hours * 3600 * 1000;
	return articles.filter((a) => {
		const d = parseDateSafe(a.pubDate);
		return now - d.getTime() <= thresholdMs;
	});
}

export function getSourceDomain(link: string): string {
	try {
		const u = new URL(link);
		return u.hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}


