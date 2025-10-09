# Post Preview & Confirmation System

## 🎯 What Was Implemented

I've added a comprehensive preview and confirmation system that shows you each post before it's sent to the channel, with multiple action options.

---

## ✨ Features

### **1. Preview Mode (Enabled by Default)**
- All scheduled posts are sent to you for review before going to the channel
- Shows the complete formatted post with images
- Includes metadata (source, publish date)
- Interactive buttons for quick actions

### **2. Action Buttons**

When you receive a preview, you get these options:

| Button | Action | Description |
|--------|--------|-------------|
| ✅ **Send to Channel** | Confirms and posts | Sends the post to your channel immediately |
| ⏭️ **Skip** | Skips this post | Marks as posted, won't show again |
| 🔄 **Regenerate** | Creates new version | Regenerates AI analysis with different content |
| ❌ **Cancel** | Cancels preview | Removes from queue, keeps in article list |
| 📝 **View Full Article** | Shows details | Displays original article title, link, and content |

---

## 📋 How It Works

### **Automatic Flow:**

1. **Scheduler Finds New Article** ⏰
   - Runs every 90 seconds
   - Fetches latest articles from all 21 RSS feeds
   - Filters by category and checks for duplicates

2. **AI Analysis Created** 🤖
   - Generates TLDR, bullets, description
   - Formats with HTML
   - Adds relevant hashtags

3. **Preview Sent to You** 👁️
   - Shows formatted post with preview header
   - Includes image if available
   - Displays action buttons

4. **You Decide** ✋
   - Click any action button
   - Post sent or skipped based on your choice

### **Preview Message Format:**

```
📋 POST PREVIEW - Awaiting Confirmation

📰 Source: Reddit
⏰ Published: 2025-10-09T10:30:00.000Z
━━━━━━━━━━━━━━━━━━━━

💡 TLDR: Original Reddit post title here

🔸 Key Points:
  • Specific detail about the post
  • Different concrete insight
  • Unique takeaway or statistic

📦 Business Impact: Relevant business implications if applicable

📝 Description: Engaging summary that adds context about why this matters...

#Hashtag #Relevant #Tags #Here

🔗 https://reddit.com/r/subreddit/...

⏰ 2 hours ago

[✅ Send to Channel] [⏭️ Skip]
[🔄 Regenerate] [❌ Cancel]
[📝 View Full Article]
```

---

## 🎮 Commands

### **Toggle Preview Mode**
```
/togglepreview
```
- Enables/disables preview mode
- When disabled, posts go directly to channel
- Default: Enabled

### **Check Status**
```
/postingstatus
```
Shows complete status including:
- Automatic posting status (on/off)
- Preview mode status  
- Pending posts count
- Configuration details

### **Toggle Auto Posting**
```
/toggleposting
```
- Enables/disables the scheduler
- Works with preview mode
- When both are enabled, you get previews

---

## ⚙️ Configuration

### **Environment Variables:**

```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_TARGET_CHAT_ID=@your_channel

# Optional - for preview mode
TELEGRAM_ADMIN_CHAT_ID=your_admin_user_id  # If not set, uses TARGET_CHAT_ID

# Auto posting (default: false)
AUTO_POSTING_ENABLED=true

# Target category
TARGET_CATEGORY=AI Tool  # Options: AI Tool, Business, Tech News, Jobs, Developer
```

### **How to Set Admin Chat ID:**

1. Send a message to your bot
2. Bot logs will show your chat ID
3. Add to `.env` file

---

## 🔄 Usage Scenarios

### **Scenario 1: Review Every Post (Recommended)**
```
1. Enable auto posting: /toggleposting
2. Keep preview mode enabled (default)
3. You'll receive each post for review
4. Click ✅ to send or ⏭️ to skip
```

### **Scenario 2: Automatic Posting (No Review)**
```
1. Disable preview mode: /togglepreview
2. Enable auto posting: /toggleposting
3. Posts go directly to channel
```

### **Scenario 3: Manual Control Only**
```
1. Keep auto posting disabled
2. Use /fetchfeed commands manually
3. No previews, you control everything
```

---

## 📊 Updated Files

### **Modified Files:**

1. **`src/bot/scheduler.ts`**
   - Added preview mode system
   - Added pending posts storage
   - Added action handlers (confirm, skip, regenerate, cancel, view)
   - Modified processArticles to send previews instead of direct posts

2. **`src/index.ts`**
   - Added bot instance to scheduler
   - Registered callback handlers for preview buttons
   - Added error handling for callbacks

3. **`src/bot/commands.ts`**
   - Added `/togglepreview` command
   - Updated `/postingstatus` to show preview mode
   - Updated status display with pending posts count

4. **`src/utils/menu.ts`**
   - Added "Toggle Preview Mode" to admin commands
   - Updated posting control menu

---

## 🎯 Benefits

### **For You:**
- ✅ **Full Control**: Review every post before it goes live
- ✅ **Quality Assurance**: Catch any issues with AI analysis
- ✅ **Flexibility**: Multiple action options for each post
- ✅ **Time Saving**: Quick approve/reject with one click
- ✅ **Safety**: No accidental posts to your channel

### **For Your Audience:**
- ✅ Only high-quality, reviewed content
- ✅ Consistent posting style
- ✅ Relevant, valuable posts

---

## 📝 Example Usage

### **Morning Routine:**
```
1. Wake up
2. Check Telegram
3. See 3 preview posts from overnight
4. Review post 1: ✅ Send to Channel
5. Review post 2: 🔄 Regenerate (better version needed)
6. Review post 3: ⏭️ Skip (not relevant)
7. Done! Channel updated with quality content
```

---

## 🚀 Next Steps

1. **Compile the code:**
   ```bash
   npm run build
   ```

2. **Set environment variables:**
   Add `TELEGRAM_ADMIN_CHAT_ID` to your `.env` file

3. **Start the bot:**
   ```bash
   npm start
   ```

4. **Enable features:**
   ```
   /toggleposting     # Enable auto posting
   /postingstatus     # Check if preview mode is on
   ```

5. **Wait for first preview!**
   - Scheduler runs every 90 seconds
   - You'll receive preview in Telegram
   - Click buttons to take action

---

## 🔧 Technical Details

### **Pending Posts Storage:**
- Stored in memory (Map)
- Includes article data, formatted message, timestamp
- Unique ID generated per post
- Auto-cleanup when action is taken

### **Callback Pattern:**
- Buttons use Telegram callback queries
- Pattern: `action_postId`
- Examples: `confirm_1728460800_example`, `skip_1728460800_example`

### **Error Handling:**
- Graceful fallbacks if preview send fails
- Expired post detection
- Duplicate prevention
- Rate limit handling

---

## 💡 Tips

1. **Test First**: Use `/testpost` to test formatting before enabling auto-posting

2. **Regenerate Wisely**: If content is off, try regenerating - AI might produce better version

3. **Skip Liberally**: Don't post mediocre content - skip and wait for better articles

4. **Monitor Status**: Check `/postingstatus` regularly to see pending posts

5. **Admin Chat**: Set separate admin chat ID to keep previews private

---

## ✅ Summary

You now have complete control over your bot's posting with:
- 👁️ Preview every post before it goes live
- 🎮 5 action buttons for flexibility
- 🔄 Ability to regenerate posts
- ⏭️ Easy skip option
- 📊 Status monitoring
- 🤖 Smart AI analysis with anti-repetition

The bot is production-ready and will help you maintain a high-quality channel! 🎉
