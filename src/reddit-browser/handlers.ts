/**
 * Reddit Browser Command and Callback Handlers
 */

import { Context, Markup } from 'telegraf';
import { logger } from '../logger';
import { redditBrowser } from './service';
import { getEnabledRedditFeeds } from './config';

/**
 * Create inline keyboard for Reddit browser preview
 */
function createBrowserKeyboard(
	nextSubreddit?: string
): any {
	const buttons = [];
	
	// First row: Confirm and Next
	buttons.push([
		Markup.button.callback('✅ Post to Channel', 'reddit_confirm'),
		Markup.button.callback(
			nextSubreddit ? `➡️ Next (r/${nextSubreddit})` : '➡️ Next',
			'reddit_next'
		),
	]);

	// Second row: Skip forever and Cancel
	buttons.push([
		Markup.button.callback('🗑️ Skip Forever', 'reddit_skip'),
		Markup.button.callback('❌ Exit Browser', 'reddit_cancel'),
	]);

	return Markup.inlineKeyboard(buttons);
}

/**
 * Format preview message with Reddit browser header
 */
function formatPreviewMessage(
	message: string,
	subreddit: string,
	progress: { current: number; total: number; posted: number; skipped: number }
): string {
	const header = 
		`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
		`┃ 📱 <b>REDDIT BROWSER</b> - Preview ${progress.current}/${progress.total}\n` +
		`┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
		`🏷️ <b>Subreddit:</b> r/${subreddit}\n` +
		`📊 <b>Progress:</b> ${progress.posted} posted • ${progress.skipped} skipped\n` +
		`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

	return header + message;
}

/**
 * Handle /reddit_browse command - Start interactive browsing
 */
export async function handleRedditBrowseCommand(ctx: Context): Promise<void> {
	try {
		const userId = ctx.from?.id;
		const chatId = ctx.chat?.id;

		if (!userId || !chatId) {
			await ctx.reply('❌ Could not identify user or chat.');
			return;
		}

		// Check if Reddit feeds are enabled
		const feeds = getEnabledRedditFeeds();
		if (feeds.length === 0) {
			await ctx.reply(
				'❌ <b>No Reddit Feeds Enabled</b>\n\n' +
				'All Reddit feeds are currently disabled. Please enable some feeds in the configuration first.',
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Start new browsing session
		await redditBrowser.startSession(userId, chatId);

		// Show loading message
		const loadingMsg = await ctx.reply(
			`🔍 <b>Starting Reddit Browser...</b>\n\n` +
			`📂 Loading ${feeds.length} enabled subreddits\n` +
			`⏳ Please wait...`,
			{ parse_mode: 'HTML' }
		);

		try {
			// Get first article
			const preview = await redditBrowser.getNextArticle(userId);

			// Delete loading message
			await ctx.deleteMessage(loadingMsg.message_id).catch(() => {});

			if (!preview) {
				await ctx.reply(
					'😕 <b>No Articles Found</b>\n\n' +
					'Could not find any new articles in the enabled subreddits. Try again later!',
					{ parse_mode: 'HTML' }
				);
				redditBrowser.endSession(userId);
				return;
			}

			// Send preview with buttons
			const formattedMessage = formatPreviewMessage(
				preview.formattedMessage,
				preview.subreddit,
				preview.progress
			);

			const keyboard = createBrowserKeyboard(
				preview.nextSubreddit
			);

			// Send preview (with image if available)
			if (preview.article.imageUrl) {
				const captionLimit = 950; // Safe limit for Telegram captions
				
				if (formattedMessage.length <= captionLimit) {
					await ctx.replyWithPhoto(preview.article.imageUrl, {
						caption: formattedMessage,
						parse_mode: 'HTML',
						...keyboard
					});
				} else {
					// Send compact caption with image, then full message separately
					const compactCaption = 
						`📱 <b>REDDIT BROWSER</b> ${preview.progress.current}/${preview.progress.total}\n` +
						`🏷️ r/${preview.subreddit} • 📊 ${preview.progress.posted} posted • ${preview.progress.skipped} skipped`;
					
					await ctx.replyWithPhoto(preview.article.imageUrl, {
						caption: compactCaption,
						parse_mode: 'HTML'
					});
					
					await ctx.reply(formattedMessage, {
						parse_mode: 'HTML',
						...keyboard
					});
				}
			} else {
				await ctx.reply(formattedMessage, {
					parse_mode: 'HTML',
					...keyboard
				});
			}

		} catch (err) {
			// Delete loading message
			await ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
			throw err;
		}

	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			userId: ctx.from?.id 
		}, 'Failed to handle reddit_browse command');
		
		await ctx.reply(
			'❌ <b>Error Starting Browser</b>\n\n' +
			'Something went wrong while starting the Reddit browser. Please try again.',
			{ parse_mode: 'HTML' }
		);
	}
}

/**
 * Handle "Confirm & Post" button callback
 */
export async function handleRedditConfirm(ctx: Context): Promise<void> {
	try {
		await ctx.answerCbQuery('📤 Posting to channel...');

		const userId = ctx.from?.id;
		if (!userId) {
			await ctx.reply('❌ Could not identify user.');
			return;
		}

		// Get the current session and article
		const session = redditBrowser.getSession(userId);
		if (!session || !session.currentArticle) {
			await ctx.reply('❌ <b>Session Expired</b>\n\nPlease start a new browsing session with /reddit_browse', {
				parse_mode: 'HTML'
			});
			return;
		}

		const articleLink = session.currentArticle.link;

		// Get target channel
		const targetChat = process.env.TELEGRAM_TARGET_CHAT_ID;
		if (!targetChat) {
			await ctx.reply('❌ Target channel not configured.');
			return;
		}

		// We need to re-fetch the article details from the message
		// For now, we'll use a workaround: extract from the current message
		const message = (ctx as any).callbackQuery?.message;
		if (!message) {
			await ctx.reply('❌ Could not get message details.');
			return;
		}

		try {
			// Extract the message content
			const messageText = message.caption || message.text || '';
			const imageUrl = message.photo ? message.photo[message.photo.length - 1]?.file_id : undefined;

			// Remove the Reddit browser header to get the actual post content
			const postContent = messageText.split('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n').slice(1).join('\n\n');

			// Post to channel
			if (imageUrl) {
				await ctx.telegram.sendPhoto(targetChat, imageUrl, {
					caption: postContent,
					parse_mode: 'HTML'
				});
			} else {
				await ctx.telegram.sendMessage(targetChat, postContent, {
					parse_mode: 'HTML'
				});
			}

			// Mark as posted in session
			await redditBrowser.confirmPost(userId, articleLink);

			// Delete the preview message
			try {
				await ctx.deleteMessage();
			} catch {
				// Ignore deletion errors
			}

			// Show confirmation and load next
			await ctx.reply('✅ <b>Posted Successfully!</b>\n\n📥 Loading next article...', {
				parse_mode: 'HTML'
			});

			// Get next article
			const nextPreview = await redditBrowser.getNextArticle(userId);

			if (!nextPreview) {
				// End of browsing
				const summary = redditBrowser.getSessionSummary(userId);
				await ctx.reply(
					'🎉 <b>Browsing Complete!</b>\n\n' +
					(summary || 'No more articles to browse.') +
					'\n\n💡 Use /reddit_browse to start a new session.',
					{ parse_mode: 'HTML' }
				);
				redditBrowser.endSession(userId);
				return;
			}

			// Send next preview
			const formattedMessage = formatPreviewMessage(
				nextPreview.formattedMessage,
				nextPreview.subreddit,
				nextPreview.progress
			);

			const keyboard = createBrowserKeyboard(
				nextPreview.nextSubreddit
			);

			if (nextPreview.article.imageUrl) {
				const captionLimit = 950; // Safe limit for Telegram captions
				
				if (formattedMessage.length <= captionLimit) {
					await ctx.replyWithPhoto(nextPreview.article.imageUrl, {
						caption: formattedMessage,
						parse_mode: 'HTML',
						...keyboard
					});
				} else {
					// Send compact caption with image, then full message separately
					const compactCaption = 
						`📱 <b>REDDIT BROWSER</b> ${nextPreview.progress.current}/${nextPreview.progress.total}\n` +
						`🏷️ r/${nextPreview.subreddit} • 📊 ${nextPreview.progress.posted} posted • ${nextPreview.progress.skipped} skipped`;
					
					await ctx.replyWithPhoto(nextPreview.article.imageUrl, {
						caption: compactCaption,
						parse_mode: 'HTML'
					});
					
					await ctx.reply(formattedMessage, {
						parse_mode: 'HTML',
						...keyboard
					});
				}
			} else {
				await ctx.reply(formattedMessage, {
					parse_mode: 'HTML',
					...keyboard
				});
			}

		} catch (postErr) {
			logger.error({ 
				err: postErr instanceof Error ? postErr.message : String(postErr),
				articleLink: articleLink.substring(0, 80)
			}, 'Failed to post article to channel');
			
			await ctx.reply('❌ Failed to post to channel. The article may have been deleted.');
		}

	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			userId: ctx.from?.id 
		}, 'Failed to handle reddit_confirm callback');
		
		await ctx.answerCbQuery('❌ Error posting article').catch(() => {});
	}
}

/**
 * Handle "Next" button callback
 */
export async function handleRedditNext(ctx: Context): Promise<void> {
	try {
		await ctx.answerCbQuery('⏭️ Loading next...');

		const userId = ctx.from?.id;
		if (!userId) {
			await ctx.reply('❌ Could not identify user.');
			return;
		}

		// Get the current session and article
		const session = redditBrowser.getSession(userId);
		if (!session || !session.currentArticle) {
			await ctx.reply('❌ <b>Session Expired</b>\n\nPlease start a new browsing session with /reddit_browse', {
				parse_mode: 'HTML'
			});
			return;
		}

		const articleLink = session.currentArticle.link;

		// Skip this article
		redditBrowser.skipArticle(userId, articleLink);

		// Delete the current preview message
		try {
			await ctx.deleteMessage();
		} catch {
			// Ignore deletion errors
		}

		// Get next article
		const nextPreview = await redditBrowser.getNextArticle(userId);

		if (!nextPreview) {
			// End of browsing
			const summary = redditBrowser.getSessionSummary(userId);
			await ctx.reply(
				'🎉 <b>Browsing Complete!</b>\n\n' +
				(summary || 'No more articles to browse.') +
				'\n\n💡 Use /reddit_browse to start a new session.',
				{ parse_mode: 'HTML' }
			);
			redditBrowser.endSession(userId);
			return;
		}

		// Send next preview
		const formattedMessage = formatPreviewMessage(
			nextPreview.formattedMessage,
			nextPreview.subreddit,
			nextPreview.progress
		);

		const keyboard = createBrowserKeyboard(
			nextPreview.nextSubreddit
		);

		if (nextPreview.article.imageUrl) {
			const captionLimit = 950; // Safe limit for Telegram captions
			
			if (formattedMessage.length <= captionLimit) {
				await ctx.replyWithPhoto(nextPreview.article.imageUrl, {
					caption: formattedMessage,
					parse_mode: 'HTML',
					...keyboard
				});
			} else {
				// Send compact caption with image, then full message separately
				const compactCaption = 
					`📱 <b>REDDIT BROWSER</b> ${nextPreview.progress.current}/${nextPreview.progress.total}\n` +
					`🏷️ r/${nextPreview.subreddit} • 📊 ${nextPreview.progress.posted} posted • ${nextPreview.progress.skipped} skipped`;
				
				await ctx.replyWithPhoto(nextPreview.article.imageUrl, {
					caption: compactCaption,
					parse_mode: 'HTML'
				});
				
				await ctx.reply(formattedMessage, {
					parse_mode: 'HTML',
					...keyboard
				});
			}
		} else {
			await ctx.reply(formattedMessage, {
				parse_mode: 'HTML',
				...keyboard
			});
		}

	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			userId: ctx.from?.id 
		}, 'Failed to handle reddit_next callback');
		
		await ctx.answerCbQuery('❌ Error loading next article').catch(() => {});
	}
}

/**
 * Handle "Skip Forever" button callback
 */
export async function handleRedditSkip(ctx: Context): Promise<void> {
	try {
		await ctx.answerCbQuery('🗑️ Skipping permanently...');

		const userId = ctx.from?.id;
		if (!userId) {
			await ctx.reply('❌ Could not identify user.');
			return;
		}

		// Get the current session and article
		const session = redditBrowser.getSession(userId);
		if (!session || !session.currentArticle) {
			await ctx.reply('❌ <b>Session Expired</b>\n\nPlease start a new browsing session with /reddit_browse', {
				parse_mode: 'HTML'
			});
			return;
		}

		const article = session.currentArticle;

		// Skip forever (marks as posted)
		await redditBrowser.skipForever(userId, article);

		// Delete the current preview message
		try {
			await ctx.deleteMessage();
		} catch {
			// Ignore deletion errors
		}

		// Get next article
		const nextPreview = await redditBrowser.getNextArticle(userId);

		if (!nextPreview) {
			// End of browsing
			const summary = redditBrowser.getSessionSummary(userId);
			await ctx.reply(
				'🎉 <b>Browsing Complete!</b>\n\n' +
				(summary || 'No more articles to browse.') +
				'\n\n💡 Use /reddit_browse to start a new session.',
				{ parse_mode: 'HTML' }
			);
			redditBrowser.endSession(userId);
			return;
		}

		// Send next preview
		const formattedMessage = formatPreviewMessage(
			nextPreview.formattedMessage,
			nextPreview.subreddit,
			nextPreview.progress
		);

		const keyboard = createBrowserKeyboard(
			nextPreview.nextSubreddit
		);

		if (nextPreview.article.imageUrl) {
			const captionLimit = 950; // Safe limit for Telegram captions
			
			if (formattedMessage.length <= captionLimit) {
				await ctx.replyWithPhoto(nextPreview.article.imageUrl, {
					caption: formattedMessage,
					parse_mode: 'HTML',
					...keyboard
				});
			} else {
				// Send compact caption with image, then full message separately
				const compactCaption = 
					`📱 <b>REDDIT BROWSER</b> ${nextPreview.progress.current}/${nextPreview.progress.total}\n` +
					`🏷️ r/${nextPreview.subreddit} • 📊 ${nextPreview.progress.posted} posted • ${nextPreview.progress.skipped} skipped`;
				
				await ctx.replyWithPhoto(nextPreview.article.imageUrl, {
					caption: compactCaption,
					parse_mode: 'HTML'
				});
				
				await ctx.reply(formattedMessage, {
					parse_mode: 'HTML',
					...keyboard
				});
			}
		} else {
			await ctx.reply(formattedMessage, {
				parse_mode: 'HTML',
				...keyboard
			});
		}

	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			userId: ctx.from?.id 
		}, 'Failed to handle reddit_skip callback');
		
		await ctx.answerCbQuery('❌ Error skipping article').catch(() => {});
	}
}

/**
 * Handle "Cancel" button callback
 */
export async function handleRedditCancel(ctx: Context): Promise<void> {
	try {
		const userId = ctx.from?.id;
		if (!userId) {
			await ctx.answerCbQuery('❌ Could not identify user');
			return;
		}

		// Get session summary before ending
		const summary = redditBrowser.getSessionSummary(userId);

		// End session
		redditBrowser.endSession(userId);

		// Delete the current preview message
		try {
			await ctx.deleteMessage();
		} catch {
			// Ignore deletion errors
		}

		await ctx.answerCbQuery('👋 Browse session ended');
		
		await ctx.reply(
			'👋 <b>Browsing Session Ended</b>\n\n' +
			(summary || 'Session closed.') +
			'\n\n💡 Use /reddit_browse to start a new session.',
			{ parse_mode: 'HTML' }
		);

	} catch (err) {
		logger.error({ 
			err: err instanceof Error ? err.message : String(err),
			userId: ctx.from?.id 
		}, 'Failed to handle reddit_cancel callback');
		
		await ctx.answerCbQuery('❌ Error ending session').catch(() => {});
	}
}

