/**
 * Zod schemas for type-safe AI analysis results
 */
import { z } from 'zod';

/**
 * Schema for AI analysis result
 */
export const AnalysisResultSchema = z.object({
	tldr: z.string().min(1, 'TLDR must not be empty').describe('One compelling sentence capturing the main news'),
	bullets: z.array(z.string().min(1)).min(3).max(3).describe('Three distinct specific points'),
	business_implication: z.string().describe('Specific business/market impact - empty string if not applicable'),
	target_audience: z.string().min(1).describe('Specific job roles/industries who would benefit'),
	description: z.string().min(1).describe('Engaging 2-3 sentences that add context'),
	hashtags: z.array(z.string().min(1)).min(4).max(6).describe('4-6 relevant hashtags without # symbols')
});

/**
 * TypeScript type inferred from Zod schema
 */
export type AnalysisResultType = z.infer<typeof AnalysisResultSchema>;

/**
 * Coerce and validate analysis result
 */
export function validateAndCoerceResult(obj: any): AnalysisResultType {
	try {
		// Coerce the data to match expected types
		const coerced = {
			tldr: String(obj?.tldr ?? '').trim(),
			bullets: Array.isArray(obj?.bullets) 
				? obj.bullets.map((b: any) => String(b).trim()).filter((b: string) => b.length > 0)
				: [],
			business_implication: String(obj?.business_implication ?? '').trim(),
			target_audience: String(obj?.target_audience ?? '').trim(),
			description: String(obj?.description ?? '').trim(),
			hashtags: Array.isArray(obj?.hashtags) 
				? obj.hashtags.map((h: any) => String(h).replace(/^#/, '').trim()).filter((h: string) => h.length > 0)
				: []
		};
		
		// Validate with Zod schema
		return AnalysisResultSchema.parse(coerced);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const errorMessages = error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join(', ');
			throw new Error(`Validation failed: ${errorMessages}`);
		}
		throw error;
	}
}

