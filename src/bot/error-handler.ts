/**
 * Bot error handling middleware and utilities
 */
import { Telegraf, Context } from 'telegraf';
import { logger } from '../logger';
import { counters } from '../metrics';
import { createMainMenu } from '../utils/menu';

/**
 * Error types for better handling
 */
export enum ErrorType {
	NETWORK = 'network',
	API_LIMIT = 'api_limit',
	PERMISSION = 'permission',
	VALIDATION = 'validation',
	INTERNAL = 'internal',
	TIMEOUT = 'timeout'
}

/**
 * Bot error class with additional context
 */
export class BotError extends Error {
	public readonly type: ErrorType;
	public readonly context?: any;
	public readonly retryable: boolean;

	constructor(
		message: string, 
		type: ErrorType = ErrorType.INTERNAL, 
		context?: any, 
		retryable: boolean = false
	) {
		super(message);
		this.name = 'BotError';
		this.type = type;
		this.context = context;
		this.retryable = retryable;
	}
}

/**
 * Determine error type from error message or object
 */
function determineErrorType(error: any): ErrorType {
	const errorMessage = error?.message?.toLowerCase() || String(error).toLowerCase();
	
	if (errorMessage.includes('network') || errorMessage.includes('enotfound') || errorMessage.includes('timeout')) {
		return ErrorType.NETWORK;
	}
	
	if (errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
		return ErrorType.API_LIMIT;
	}
	
	if (errorMessage.includes('forbidden') || errorMessage.includes('unauthorized') || errorMessage.includes('permission')) {
		return ErrorType.PERMISSION;
	}
	
	if (errorMessage.includes('bad request') || errorMessage.includes('invalid')) {
		return ErrorType.VALIDATION;
	}
	
	if (errorMessage.includes('timeout')) {
		return ErrorType.TIMEOUT;
	}
	
	return ErrorType.INTERNAL;
}

/**
 * Get user-friendly error message based on error type
 */
function getUserFriendlyMessage(error: BotError | Error): string {
	if (error instanceof BotError) {
		switch (error.type) {
			case ErrorType.NETWORK:
				return '🌐 **Network Issue**\n\nThere seems to be a connection problem. Please try again in a moment.';
			case ErrorType.API_LIMIT:
				return '⏳ **Service Busy**\n\nThe service is currently busy. Please wait a moment and try again.';
			case ErrorType.PERMISSION:
				return '🔒 **Permission Error**\n\nI don\'t have the necessary permissions to perform this action.';
			case ErrorType.VALIDATION:
				return '❌ **Invalid Request**\n\nPlease check your input and try again.';
			case ErrorType.TIMEOUT:
				return '⏱️ **Request Timeout**\n\nThe request took too long. Please try again.';
			default:
				return '🤖 **Something went wrong**\n\nAn unexpected error occurred. Please try again or contact support.';
		}
	}
	
	return '🤖 **Something went wrong**\n\nAn unexpected error occurred. Please try again.';
}

/**
 * Async handler wrapper that catches and handles errors gracefully
 */
export function asyncHandler<T extends Context = Context>(
	handler: (ctx: T, next?: () => Promise<void>) => Promise<void>,
	options?: {
		errorMessage?: string;
		logContext?: boolean;
		showMenu?: boolean;
	}
) {
	return async (ctx: T, next?: () => Promise<void>) => {
		try {
			await handler(ctx, next);
		} catch (error) {
			// Increment error counter
			counters.errorsTotal.inc({ scope: 'handler' });
			
			// Determine error type
			const errorType = determineErrorType(error);
			const botError = error instanceof BotError ? error : new BotError(
				error instanceof Error ? error.message : String(error),
				errorType,
				{ originalError: error }
			);
			
			// Log the error with context
			const logData: any = {
				error: botError.message,
				type: botError.type,
				retryable: botError.retryable,
				userId: ctx.from?.id,
				chatId: ctx.chat?.id,
				messageText: ctx.message && 'text' in ctx.message ? ctx.message.text : undefined
			};
			
			if (options?.logContext && botError.context) {
				logData.context = botError.context;
			}
			
			logger.error(logData, 'Bot handler error');
			
			// Send user-friendly error message
			try {
				const errorMessage = options?.errorMessage || getUserFriendlyMessage(botError);
				const replyOptions: any = {};
				
				if (options?.showMenu !== false) {
					replyOptions.reply_markup = createMainMenu().reply_markup;
				}
				
				await ctx.reply(errorMessage, replyOptions);
			} catch (replyError) {
				// If we can't even send an error message, just log it
				logger.error({ 
					originalError: botError.message,
					replyError: replyError instanceof Error ? replyError.message : String(replyError)
				}, 'Failed to send error message to user');
			}
		}
	};
}

/**
 * Global error handler for uncaught errors
 */
export function setupGlobalErrorHandlers(): void {
	// Handle uncaught exceptions
	process.on('uncaughtException', (error) => {
		logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
		
		// Give time for logs to flush
		setTimeout(() => {
			process.exit(1);
		}, 1000);
	});

	// Handle unhandled promise rejections
	process.on('unhandledRejection', (reason, promise) => {
		logger.fatal({ 
			reason: reason instanceof Error ? reason.message : String(reason),
			stack: reason instanceof Error ? reason.stack : undefined,
			promise: String(promise)
		}, 'Unhandled promise rejection');
		
		// Give time for logs to flush
		setTimeout(() => {
			process.exit(1);
		}, 1000);
	});

	// Handle SIGTERM gracefully
	process.on('SIGTERM', () => {
		logger.info('Received SIGTERM, shutting down gracefully');
		process.exit(0);
	});

	// Handle SIGINT gracefully
	process.on('SIGINT', () => {
		logger.info('Received SIGINT, shutting down gracefully');
		process.exit(0);
	});
}

/**
 * Bot error middleware for Telegraf
 */
export function errorMiddleware(bot: Telegraf): void {
	bot.catch((error, ctx) => {
		counters.errorsTotal.inc({ scope: 'bot_middleware' });
		
		const errorType = determineErrorType(error);
		const botError = error instanceof BotError ? error : new BotError(
			error instanceof Error ? error.message : String(error),
			errorType,
			{ originalError: error, ctx: ctx.update }
		);
		
		logger.error({
			error: botError.message,
			type: botError.type,
			updateType: ctx.updateType,
			userId: ctx.from?.id,
			chatId: ctx.chat?.id
		}, 'Bot middleware error');
		
		// Try to send a generic error message
		ctx.reply(getUserFriendlyMessage(botError), {
			reply_markup: createMainMenu().reply_markup
		}).catch((replyError) => {
			logger.error({ 
				originalError: botError.message,
				replyError: replyError instanceof Error ? replyError.message : String(replyError)
			}, 'Failed to send error message in middleware');
		});
	});
}

/**
 * Retry wrapper for operations that might fail temporarily
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	options: {
		maxRetries?: number;
		retryDelay?: number;
		errorMessage?: string;
	} = {}
): Promise<T> {
	const { maxRetries = 3, retryDelay = 1000, errorMessage } = options;
	
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			const errorType = determineErrorType(error);
			const isRetryable = errorType === ErrorType.NETWORK || 
							   errorType === ErrorType.API_LIMIT || 
							   errorType === ErrorType.TIMEOUT;
			
			if (attempt === maxRetries || !isRetryable) {
				throw new BotError(
					errorMessage || (error instanceof Error ? error.message : String(error)),
					errorType,
					{ originalError: error, attempt },
					isRetryable
				);
			}
			
			logger.warn({
				error: error instanceof Error ? error.message : String(error),
				attempt,
				maxRetries,
				retryDelay
			}, 'Operation failed, retrying...');
			
			// Wait before retrying
			await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
		}
	}
	
	// This should never be reached, but TypeScript requires it
	throw new Error('Unexpected end of retry loop');
}

/**
 * Health check function for monitoring
 */
export function healthCheck(): {
	status: 'healthy' | 'degraded' | 'unhealthy';
	checks: {
		memory: { status: string; usage: number; limit: number };
		uptime: { status: string; uptime: number };
		errors: { status: string; recentErrors: number };
	};
} {
	const memoryUsage = process.memoryUsage();
	const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
	const memoryLimitMB = 512; // Reasonable limit in MB
	
	const uptime = process.uptime();
	const recentErrors = 0; // TODO: Implement recent error tracking
	
	const checks = {
		memory: {
			status: memoryUsageMB > memoryLimitMB ? 'unhealthy' : 'healthy',
			usage: Math.round(memoryUsageMB),
			limit: memoryLimitMB
		},
		uptime: {
			status: uptime > 60 ? 'healthy' : 'starting', // Healthy after 1 minute
			uptime: Math.round(uptime)
		},
		errors: {
			status: recentErrors > 10 ? 'unhealthy' : 'healthy',
			recentErrors
		}
	};
	
	const healthyChecks = Object.values(checks).filter(check => check.status === 'healthy').length;
	const totalChecks = Object.keys(checks).length;
	
	let status: 'healthy' | 'degraded' | 'unhealthy';
	if (healthyChecks === totalChecks) {
		status = 'healthy';
	} else if (healthyChecks > totalChecks / 2) {
		status = 'degraded';
	} else {
		status = 'unhealthy';
	}
	
	return { status, checks };
}
