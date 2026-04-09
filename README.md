# AI Tech News Bot

Telegram bot that pulls AI/tech articles from RSS (and Reddit), runs them through an LLM, and can post formatted HTML to a channel—with caching, scheduling, and optional preview mode.

## Features

- Multi-source RSS aggregation and Reddit browser flow  
- Analysis via LangChain (Groq, Gemini, DeepSeek, OpenAI; set at least one API key)  
- Categorized articles, HTML posts, images/OG fallbacks, threaded long posts  
- Prometheus metrics and `/health` on `METRICS_PORT` (default `3000`)  
- Auto-posting off by default; enable in env or via the bot menu  

## Project layout

```
src/
├── ai-analysis/   LLM pipeline
├── bot/           Commands, menus, scheduler
├── data-aggregator/  RSS fetching
├── services/      Posting & images
├── storage/       Posted IDs & analysis cache
└── utils/         Helpers
```

## Quick start

1. **Node.js 18+** and `npm install`  
2. Create **`.env`** in the project root (see below).  
3. `npm run build` then `npm start` (or `npm run dev` for development).

Minimal `.env`:

```env
BOT_TOKEN=your_telegram_bot_token

# At least one:
GEMINI_API_KEY=
GROQ_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
HUGGINGFACE_API_KEY=

# Optional
TELEGRAM_TARGET_CHAT_ID=@your_channel_or_numeric_id
TARGET_CATEGORY=AI Tool
AUTO_POSTING_ENABLED=false
METRICS_PORT=3000
```

Run `npm start` only after keys validate; the app logs configuration on boot.

## Environment (common)

| Variable | Notes |
|----------|--------|
| `BOT_TOKEN` | Required. From [@BotFather](https://t.me/BotFather). |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / … | Required: at least one provider key (see `src/utils/env-validator.ts` for full list). |
| `TELEGRAM_TARGET_CHAT_ID` | Channel or chat for scheduled posts. |
| `AUTO_POSTING_ENABLED` | `true` / `false`. |
| `AI_PROVIDER` | Optional; force a single provider. |
| `*_MODEL` | Optional overrides per provider. |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript |
| `npm run start` | Run compiled bot |
| `npm run dev` | Dev run (ts-node) |
| `npm run lint` | `tsc --noEmit` |

## Ops

- Health: `GET http://localhost:<METRICS_PORT>/health`  
- Metrics: `GET http://localhost:<METRICS_PORT>/metrics`  

## License

ISC
