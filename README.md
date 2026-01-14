# Nexra API

Backend API for Nexra game analysis, built with Cloudflare Workers.

## Tech Stack

- **Hono** - Lightweight web framework
- **Cloudflare D1** - SQLite database
- **Cloudflare R2** - Video storage
- **Cloudflare Queues** - Async job processing
- **Claude AI** - Game analysis

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create D1 Database

```bash
npx wrangler d1 create nexra-db
```

Copy the `database_id` from the output and update `wrangler.toml`.

### 4. Create R2 Bucket

```bash
npx wrangler r2 bucket create nexra-videos
```

### 5. Create Queue

```bash
npx wrangler queues create nexra-analysis-queue
```

### 6. Create KV Namespace

```bash
npx wrangler kv:namespace create CACHE
```

Copy the `id` and update `wrangler.toml`.

### 7. Add Secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put RIOT_API_KEY
```

### 8. Run Database Migrations

```bash
# Local
npm run db:migrate:local

# Production
npm run db:migrate:prod
```

### 9. Start Development Server

```bash
npm run dev
```

### 10. Deploy

```bash
npm run deploy
```

## API Endpoints

### Analysis

- `GET /analysis?puuid=xxx` - List analyses for a user
- `GET /analysis/:id` - Get analysis by ID
- `GET /analysis/match/:matchId` - Get analysis by match ID
- `POST /analysis` - Create new analysis
- `DELETE /analysis/:id` - Delete analysis

### Recordings

- `GET /recordings/check/:matchId` - Check if recording exists
- `GET /recordings/:matchId` - Get recording metadata
- `POST /recordings/upload-url` - Get upload URL
- `PUT /recordings/:id/upload` - Upload video
- `GET /recordings/:id/video` - Stream video
- `DELETE /recordings/:matchId` - Delete recording

## Environment Variables

Set in `wrangler.toml`:
- `ENVIRONMENT` - development/production
- `FRONTEND_URL` - Nexra frontend URL

Set as secrets:
- `ANTHROPIC_API_KEY` - Claude API key
- `RIOT_API_KEY` - Riot Games API key
