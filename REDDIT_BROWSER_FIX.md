# Reddit Browser Fix - BUTTON_DATA_INVALID Error

## Problem
When running `/reddit_browse` command, the bot returned a `400: Bad Request: BUTTON_DATA_INVALID` error from Telegram.

## Root Cause
The inline keyboard buttons were including the full article URLs in their callback data:
```typescript
Markup.button.callback('✅ Post to Channel', `reddit_confirm:${encodeURIComponent(articleLink)}`)
```

Reddit article URLs can be very long (100+ characters), and when URL-encoded, they easily exceed Telegram's **64-byte limit** for button callback_data.

Example of a long Reddit URL:
```
https://www.reddit.com/r/PromptEngineering/comments/abc123def456/this_is_a_very_long_title_about_something_interesting/
```

## Solution
Store the current article in the user's browsing session instead of passing it through button callbacks.

### Changes Made

#### 1. Updated Session Type (`src/reddit-browser/types.ts`)
Added `currentArticle` field to store the article being previewed:
```typescript
export interface RedditBrowsingSession {
  // ... existing fields
  currentArticle?: any; // Current article being previewed
}
```

#### 2. Simplified Button Callbacks (`src/reddit-browser/handlers.ts`)
Changed from:
```typescript
createBrowserKeyboard(articleLink, nextSubreddit)
// Buttons: 'reddit_confirm:https://...'
```

To:
```typescript
createBrowserKeyboard(nextSubreddit)
// Buttons: 'reddit_confirm' (no data!)
```

#### 3. Updated Service (`src/reddit-browser/service.ts`)
Store article in session when generating preview:
```typescript
session.currentArticle = article;
```

#### 4. Updated Handlers (`src/reddit-browser/handlers.ts`)
Get article from session instead of callback data:
```typescript
const session = redditBrowser.getSession(userId);
const article = session.currentArticle;
```

#### 5. Updated Action Handlers (`src/bot/commands.ts`)
Changed from regex patterns to exact matches:
```typescript
// Before:
bot.action(/^reddit_confirm:/, ...)

// After:
bot.action('reddit_confirm', ...)
```

## Benefits
1. ✅ **Fixes the error** - Button callback data is now only 13-15 bytes (e.g., "reddit_confirm")
2. ✅ **More efficient** - No need to encode/decode URLs
3. ✅ **More secure** - Article data not exposed in button callbacks
4. ✅ **Cleaner code** - Simpler button handling logic

## Testing
The code now compiles successfully with no TypeScript errors. The Reddit browser should work correctly when you restart the bot.

## Next Steps
1. Restart the bot
2. Run `/reddit_browse` command
3. The interactive Reddit browser should now work without the BUTTON_DATA_INVALID error

