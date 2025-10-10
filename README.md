# 🤖 AI Tech News Bot

A sophisticated Telegram bot that automatically curates, analyzes, and posts AI/tech news from multiple sources using advanced AI analysis. Built with TypeScript, it features intelligent caching, multi-provider AI support, Persian translation capabilities, and comprehensive monitoring.

## ✨ Features

- **📰 Multi-Source RSS Aggregation**: Fetches from TechCrunch, OpenAI Blog, VentureBeat, The Verge, Hugging Face, Google AI Blog, and Reddit
- **🧠 AI-Powered Analysis**: Supports multiple AI providers (Gemini 2.5 Flash, Groq, DeepSeek, Hugging Face, OpenAI)
- **🎯 Intelligent Routing**: Automatically selects the best AI model for each article type
- **🔗 External Link Extraction**: Detects and displays project links from Reddit posts
- **🌍 Multi-Language Support**: Automatic Persian translation for non-RSS sources
- **💾 Smart Caching**: Prevents duplicate analysis with persistent caching
- **📊 Content Categorization**: Filters articles by category (AI Tool, AI News, etc.)
- **⏰ Automated Scheduling**: Posts new articles every 90 seconds (configurable)
- **📈 Monitoring & Metrics**: Built-in Prometheus metrics and health checks
- **🎨 Rich Formatting**: HTML-formatted posts with images, bullets, and hashtags
- **🧵 Thread Support**: Automatically splits long posts into threads
- **🔒 Safe by Default**: Manual approval required for auto-posting

## 🏗️ Architecture

```
src/
├── ai-analysis/       # AI provider integrations (OpenAI, DeepSeek, Groq)
├── bot/              # Telegram bot commands and handlers
├── categorizer/      # Content categorization logic
├── data-aggregator/  # RSS feed fetching and parsing
├── github-api/       # GitHub trending integration
├── prompts/          # AI prompt templates
├── services/         # Post creation and formatting
├── storage/          # Caching and persistence
└── utils/            # Helper utilities
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Telegram Bot Token ([Get from @BotFather](https://t.me/BotFather))
- AI API Key (choose one or more for smart routing):
  - **Google Gemini API Key** (recommended - Gemini 2.5 Flash, 1,500 req/day free)
  - Groq API Key (fast - 14,400 req/day free)
  - DeepSeek API Key (great reasoning - $5 free credits)
  - Hugging Face API Key (30,000 req/month free)
  - OpenAI API Key (premium option)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd AI-Tech-News
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp env-example.txt .env
   ```
   
   Edit `.env` and add your credentials:
   ```env
   BOT_TOKEN=your_telegram_bot_token
   
   # AI Providers (add one or more)
   GEMINI_API_KEY=your_gemini_api_key  # Recommended
   GROQ_API_KEY=your_groq_api_key
   
   # Enable intelligent routing
   ENABLE_SMART_ROUTING=true
   
   TELEGRAM_TARGET_CHAT_ID=@your_channel  # Optional
   ```

4. **Build the project**
   ```bash
   npm run build
   ```

5. **Start the bot**
   ```bash
   npm start
   ```

## 📝 Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Your Telegram bot token from @BotFather |
| AI Provider Key | One of: `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, or `OPENAI_API_KEY` |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_TARGET_CHAT_ID` | - | Channel/chat ID for auto-posting |
| `TARGET_CATEGORY` | `AI Tool` | Filter articles by category |
| `AUTO_POSTING_ENABLED` | `false` | Enable automatic posting |
| `ENABLE_SMART_ROUTING` | `false` | Enable intelligent AI provider selection |
| `METRICS_PORT` | `3000` | Port for metrics server |
| `GEMINI_API_KEY` | - | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model to use |
| `GROQ_API_KEY` | - | Groq API key |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model to use |
| `DEEPSEEK_API_KEY` | - | DeepSeek API key |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek model to use |
| `HUGGINGFACE_API_KEY` | - | Hugging Face API key |
| `HUGGINGFACE_MODEL` | `meta-llama/Meta-Llama-3-8B-Instruct` | Hugging Face model |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model to use |
| `AI_PROVIDER` | - | Force specific provider (overrides smart routing) |
| `GITHUB_TOKEN` | - | GitHub API token for trending repos |

## 🤖 AI Providers & Smart Routing

### Supported AI Providers

| Provider | Model | Speed | Quality | Free Tier | Best For |
|----------|-------|-------|---------|-----------|----------|
| **Google Gemini** | `gemini-2.5-flash` | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | 1,500 req/day | **Recommended** - Article summarization |
| **Groq** | `llama-3.3-70b-versatile` | ⚡⚡⚡⚡⚡ | ⭐⭐⭐⭐ | 14,400 req/day | High-volume, fast processing |
| **DeepSeek** | `deepseek-chat` | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | $5 credits | Complex reasoning, Reddit posts |
| **Hugging Face** | `meta-llama/Meta-Llama-3-8B-Instruct` | ⚡⚡⚡ | ⭐⭐⭐ | 30,000 req/month | Backup option |
| **OpenAI** | `gpt-4o-mini` | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | Paid | Premium quality |

### Intelligent Routing

When `ENABLE_SMART_ROUTING=true`, the bot automatically selects the best AI provider for each article type:

- **Reddit + External Links** → DeepSeek/Gemini (strong reasoning for synthesis)
- **Tech News** → Groq/Gemini (speed + accuracy)
- **AI Tools** → Gemini/Groq (creative descriptions)
- **Business Cases** → DeepSeek/Gemini (complex analysis)
- **Developer Content** → DeepSeek/Groq (technical accuracy)
- **Long Content (>2000 chars)** → Gemini (1M token context window)

### Getting API Keys (All FREE)

1. **Google Gemini**: https://makersuite.google.com/app/apikey
2. **Groq**: https://console.groq.com/keys
3. **DeepSeek**: https://platform.deepseek.com/
4. **Hugging Face**: https://huggingface.co/settings/tokens
5. **OpenAI**: https://platform.openai.com/api-keys

## 🎮 Usage

### Bot Commands

- `/start` - Start the bot and see the latest article
- `/fetch` - Fetch latest articles from RSS feeds
- `/post` - Post the newest article to your channel
- `/test` - Test scheduler without posting
- `/status` - Check bot status and configuration
- `/toggle` - Enable/disable automatic posting
- `/cache` - View cache statistics

### Interactive Menu

The bot provides an interactive menu with options:
- 📰 Latest Articles
- 📤 Post to Channel
- 🔄 Fetch New Articles
- 📊 Cache Stats
- ⚙️ Bot Status
- 🤖 Toggle Auto-Posting

## 🔧 Development

### Available Scripts

```bash
npm run build        # Build TypeScript to JavaScript
npm run build:prod   # Production build (no source maps)
npm run start        # Run the compiled bot
npm run dev          # Run in development mode with ts-node
npm run clean        # Clean build artifacts
npm run lint         # Type-check without emitting files
npm run type-check   # Type-check in watch mode
```

### Project Structure

- **TypeScript Configuration**: Strict mode enabled with comprehensive type checking
- **Incremental Builds**: Fast rebuilds using TypeScript's incremental compilation
- **Structured Logging**: JSON logging with Pino for production
- **Metrics**: Prometheus-compatible metrics on `/metrics` endpoint
- **Health Checks**: Health endpoint on `/health`

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### Metrics
```bash
curl http://localhost:3000/metrics
```

Available metrics:
- `bot_messages_received_total` - Total messages received
- `bot_commands_handled_total` - Commands handled by type
- `bot_posts_sent_total` - Posts sent to channels
- `bot_errors_total` - Errors by scope
- `bot_cron_runs_total` - Scheduler executions

## 🌟 Advanced Features

### AI Analysis

The bot generates:
- **TL;DR**: Concise one-sentence summary
- **Key Bullets**: 3 main insights
- **Business Implications**: Market/business impact analysis
- **Target Audience**: Relevant professional groups
- **Description**: Engaging 2-3 sentence social media copy
- **Hashtags**: Relevant tags for discoverability

### Caching System

- Automatically caches AI analysis results
- Prevents duplicate processing of the same article
- Auto-cleanup keeps only the 1000 most recent entries
- Persistent storage in JSON format

### Persian Translation

Automatically translates content for non-RSS sources, providing native Persian content including:
- Persian hashtags
- Right-to-left text formatting
- Cultural and linguistic adaptation

### Content Threading

Long posts are automatically split into threads:
- Respects Telegram's 4096 character limit
- Smart HTML-aware splitting
- Image attached to first thread message
- 1-second delay between thread messages

## 🔐 Security Best Practices

- **Environment Variables**: Never commit `.env` files
- **Auto-Posting Disabled**: Requires explicit enabling for safety
- **Input Validation**: Sanitizes AI responses and external data
- **Error Handling**: Comprehensive error catching with fallbacks
- **Rate Limiting**: Built-in delays to respect RSS feed rate limits

## 🐛 Troubleshooting

### Common Issues

**Bot not starting:**
- Check that `BOT_TOKEN` is set correctly
- Verify at least one AI provider key is configured
- Check logs in `logs.ndjson` for error details

**No articles fetched:**
- Verify internet connection
- Check if RSS feeds are accessible
- Review rate limiting warnings in logs

**AI analysis failing:**
- Verify API key is valid and has credits
- Check provider status pages
- Review fallback analysis in logs

**Auto-posting not working:**
- Ensure `TELEGRAM_TARGET_CHAT_ID` is set
- Set `AUTO_POSTING_ENABLED=true`
- Make bot admin in target channel

## 📦 Dependencies

### Core Dependencies
- `telegraf` - Telegram bot framework
- `openai` - OpenAI API client
- `groq-sdk` - Groq API client
- `axios` - HTTP client
- `rss-parser` - RSS feed parsing
- `node-cron` - Task scheduling
- `pino` - Structured logging
- `prom-client` - Prometheus metrics
- `express` - Web server for metrics

### Development Dependencies
- `typescript` - TypeScript compiler
- `ts-node` - TypeScript execution
- `@types/node` - Node.js type definitions

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add/update tests if applicable
5. Submit a pull request

## 📄 License

ISC License

## 🙏 Acknowledgments

- Built for AI enthusiasts and business professionals
- Powered by OpenAI, DeepSeek, and Groq
- RSS feeds from leading tech publications
- Telegram Bot API

---

**Made with ❤️ for the AI community**

For issues, questions, or suggestions, please open an issue on GitHub.
