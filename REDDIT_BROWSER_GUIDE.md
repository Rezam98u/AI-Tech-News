# 📱 Reddit Browser - Interactive Subreddit Browsing System

## 🎯 Overview

The Reddit Browser is an **interactive, on-demand system** for browsing and posting Reddit content. Unlike the old auto-posting system that fetched ALL subreddits at once, this new system:

- ✅ **Fetches one subreddit at a time** (no rate limiting issues)
- ✅ **Shows you a preview** before posting (full quality control)
- ✅ **Prioritizes important subreddits** (r/SaaS first, then r/IMadeThis, etc.)
- ✅ **Interactive buttons** for easy navigation
- ✅ **Session-based** with automatic cleanup
- ✅ **Separates Reddit from other feeds** (Reddit = manual, Tech News = auto)

---

## 🚀 How to Use

### **Starting a Browse Session**

```
/reddit_browse  (or just /reddit)
```

**What happens:**
1. Bot fetches the **top post** from the first priority subreddit (e.g., r/SaaS)
2. AI analyzes and creates a formatted preview
3. Shows you the preview with interactive buttons

### **Interactive Buttons**

| Button | Action |
|--------|--------|
| **✅ Post to Channel** | Posts to your channel immediately + loads next |
| **➡️ Next** | Skip this one, show me the next subreddit |
| **🗑️ Skip Forever** | Never show me this article again |
| **❌ Exit Browser** | End session and show summary |

### **Session Management**

- **Automatic expiry**: 30 minutes of inactivity
- **Progress tracking**: Shows `Posted: 5 • Skipped: 2`
- **Smart resuming**: Remembers where you left off

---

## ⚙️ Configuration

### **Priority List** (`src/reddit-browser/config.ts`)

Subreddits are fetched in priority order:

```typescript
Priority 1: r/SaaS (top posts, last 24h)
Priority 2: r/IMadeThis (top posts, last 24h)
Priority 3: r/indiehackers (top posts, last 24h)
Priority 4: r/SideProject (top posts, last 24h)
Priority 5: r/microsaas (top posts, last 24h)
...and more
```

**To customize:**
1. Edit `src/reddit-browser/config.ts`
2. Change `priority` numbers (lower = higher priority)
3. Set `enabled: false` to skip a subreddit
4. Change `sortBy` to `'hot'`, `'new'`, or `'top'`
5. Change `timeframe` to `'hour'`, `'day'`, `'week'`, or `'month'`

### **Environment Variables**

Add to your `.env`:

```env
# Reddit Browser Settings
REDDIT_AUTO_FETCH=false  # Set to 'true' to include Reddit in auto-posting (NOT recommended)
```

**By default**, Reddit feeds are **excluded** from auto-posting and only accessible via `/reddit_browse`.

---

## 🔄 How It Works

### **Architecture**

```
User → /reddit_browse
    ↓
RedditBrowserService creates session
    ↓
Fetches Priority #1 subreddit (r/SaaS)
    ↓
AI analysis (uses smart routing - DeepSeek/Gemini for Reddit)
    ↓
Shows formatted preview with buttons
    ↓
User clicks button → Action + Load next
    ↓
Repeats until all enabled subreddits browsed
    ↓
Shows summary → End session
```

### **Key Components**

| File | Purpose |
|------|---------|
| `reddit-browser/config.ts` | Priority list & settings |
| `reddit-browser/service.ts` | Session management & logic |
| `reddit-browser/handlers.ts` | Command & button handlers |
| `reddit-browser/types.ts` | TypeScript interfaces |
| `data-aggregator/index.ts` | `fetchSingleRedditFeed()` function |
| `bot/scheduler.ts` | Auto-posting (excludes Reddit by default) |

---

## 📊 Preview Message Format

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ 📱 REDDIT BROWSER - Preview 3/10
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏷️ Subreddit: r/SaaS
📊 Progress: 2 posted • 1 skipped

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Your formatted AI-analyzed post here]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🎨 Smart Features

### **1. Intelligent AI Routing**
Reddit posts automatically use **DeepSeek** or **Gemini** for better reasoning:
- Synthesizes post description + external links
- Understands context better than Groq
- Creates more accurate TL;DR

### **2. External Link Detection**
Automatically extracts and displays project links:
```
🔗 Project: summeze.com
```

### **3. Session Tracking**
- Remembers which articles you've seen
- Prevents duplicate previews
- Tracks posted/skipped counts

### **4. Auto-Cleanup**
- Expires inactive sessions after 30 minutes
- Cleans up old pending posts
- Memory-efficient

---

## 🆚 Old System vs New System

| Feature | Old (Auto-Posting) | New (Browser) |
|---------|-------------------|---------------|
| **Fetching** | All at once (11+ feeds) | One at a time |
| **Rate Limits** | ❌ Constant 403/429 errors | ✅ No issues |
| **Control** | ❌ Auto-posts everything | ✅ Preview before posting |
| **Priority** | ❌ Random order | ✅ Custom priority |
| **Quality** | ❌ Some bad posts slip through | ✅ Manual quality check |
| **Speed** | Fast but error-prone | Slower but reliable |

---

## 🛠️ Troubleshooting

### **"No Reddit Feeds Enabled"**
- Check `src/reddit-browser/config.ts`
- Make sure at least one feed has `enabled: true`

### **"Session Expired"**
- Sessions auto-expire after 30 minutes
- Just start a new session with `/reddit_browse`

### **"No Articles Found"**
- The subreddit might be empty or all posts are already posted
- Try again later or check the priority list

### **Reddit 403/429 Errors**
- The browser respects rate limits automatically
- Wait 1-2 seconds between subreddits
- Check your headers in `data-aggregator/index.ts`

---

## 📈 Future Enhancements

Potential improvements:
- [ ] Pre-fetch next 3 subreddits for instant navigation
- [ ] Add "Save for Later" button
- [ ] Configurable priority list via commands
- [ ] Analytics dashboard (most posted subreddits)
- [ ] Multi-user support (different priorities per user)
- [ ] Schedule browser sessions (e.g., every morning)

---

## 🎮 Commands Summary

| Command | Description |
|---------|-------------|
| `/reddit_browse` | Start interactive browsing |
| `/reddit` | Shortcut for `/reddit_browse` |
| `📱 Browse Reddit` | Button in main menu |

---

## 🔧 Developer Notes

### **Adding a New Subreddit**

1. Open `src/reddit-browser/config.ts`
2. Add to `REDDIT_FEED_PRIORITIES`:
   ```typescript
   {
     name: 'YourSubreddit',
     category: 'AI Tool',
     priority: 15,
     sortBy: 'top',
     timeframe: 'day',
     enabled: true,
     description: 'Your description'
   }
   ```
3. Rebuild: `tsc` (or `npm run build`)
4. Restart bot

### **Customizing Button Layout**

Edit `src/reddit-browser/handlers.ts` → `createBrowserKeyboard()`

### **Changing AI Provider Priority**

For Reddit posts, smart routing prioritizes:
1. DeepSeek (complex reasoning)
2. Gemini (large context)
3. Groq (speed)

To change, edit `src/ai-analysis/providers.ts` → `selectProviderForArticle()`

---

## ✅ What Was Changed

### **New Files Created**
- `src/reddit-browser/types.ts` - TypeScript interfaces
- `src/reddit-browser/config.ts` - Priority list & settings
- `src/reddit-browser/service.ts` - Core browsing logic
- `src/reddit-browser/handlers.ts` - Command & button handlers
- `src/reddit-browser/index.ts` - Module exports

### **Modified Files**
- `src/data-aggregator/index.ts` - Added `fetchSingleRedditFeed()` + `excludeReddit` option
- `src/bot/commands.ts` - Added `/reddit_browse` command + callback handlers
- `src/bot/menu-handlers.ts` - Added `📱 Browse Reddit` button handler
- `src/bot/scheduler.ts` - Excludes Reddit from auto-posting by default
- `src/index.ts` - Initialized `redditBrowser` service
- `src/utils/menu.ts` - Added Reddit browser to main menu
- `README.md` - Updated with Reddit browser documentation

---

## 🎉 Benefits

1. **No More Rate Limiting** - One subreddit at a time
2. **Quality Control** - Preview before posting
3. **Prioritization** - Important subreddits first
4. **Clean Separation** - Reddit (manual) vs Tech News (auto)
5. **User-Friendly** - Interactive buttons, progress tracking
6. **Efficient** - No wasted API calls
7. **Scalable** - Easy to add/remove subreddits

---

**Enjoy your new Reddit browsing experience! 🚀**

For questions or issues, check the logs at `logs.ndjson` or use `/postingstatus` command.

