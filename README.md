# Nexra API

Backend API for Nexra game analysis, built with Cloudflare Workers.

**Production URL:** https://nexra-api.nexra-api.workers.dev

## Tech Stack

- **Hono** - Lightweight web framework
- **Cloudflare D1** - SQLite database
- **Cloudflare R2** - Video storage
- **Cloudflare Queues** - Async job processing
- **Claude AI** - Game analysis (Anthropic)

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
npx wrangler d1 execute nexra-db --file=migrations/XXX_migration.sql --remote
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

### Users & Authentication

- `POST /users/auth` - Sync user on login (creates if not exists)
  - **Important:** Finds users by EMAIL, not ID
  - Returns existing database ID for FK consistency
  - Does NOT update user ID due to foreign key constraints

- `GET /users/:id` - Get user by ID
- `PUT /users/:id/profile` - Update user profile (requires ownership)
- `PUT /users/:id/password` - Change password (requires ownership)
- `DELETE /users/:id` - Delete user account (requires ownership)

### Riot Account Linking

- `POST /users/:id/link-riot` - Link Riot account to user (requires ownership)
- `DELETE /users/:id/link-riot` - Unlink Riot account (requires ownership)

### Credits System

- `GET /users/:id/credits` - Get user credits (requires ownership)
- `POST /users/:id/use-credit` - Use 1 credit for analysis (requires ownership)
- `POST /users/:id/add-credits` - Add credits (for purchases)

### Analysis

- `GET /analysis?puuid=xxx` - List analyses for a user
- `GET /analysis/:id` - Get analysis by ID
- `GET /analysis/match/:matchId` - Get analysis by match ID
- `POST /analysis` - Create new analysis
- `DELETE /analysis/:id` - Delete analysis

### Recordings (Future)

- `GET /recordings/check/:matchId` - Check if recording exists
- `GET /recordings/:matchId` - Get recording metadata
- `POST /recordings/upload-url` - Get upload URL
- `PUT /recordings/:id/upload` - Upload video
- `GET /recordings/:id/video` - Stream video
- `DELETE /recordings/:matchId` - Delete recording

## Authentication

API uses a simple Bearer token format for authenticated requests:

```
Authorization: Bearer <user_id>:<user_email>
```

The `requireOwnership` middleware verifies that the user ID in the header matches the `:id` parameter in the URL.

## Database Schema

See `migrations/` folder for complete schema. Key tables:

### Users
- Stores user accounts with Google OAuth integration
- Linked Riot accounts (puuid, game_name, tag_line, region)
- Credits system for analysis
- **Important:** `id` is preserved and never updated due to FK constraints

### Analyses
- Stores game analysis requests and results
- References `users.id` via foreign key

### Recordings
- Stores video recording metadata
- References `users.id` via foreign key

## Environment Variables

Set in `wrangler.toml`:
- `ENVIRONMENT` - development/production
- `FRONTEND_URL` - Nexra frontend URL (https://www.nexra-ai.app)

Set as secrets:
- `ANTHROPIC_API_KEY` - Claude API key
- `RIOT_API_KEY` - Riot Games API key

## Known Issues

### Foreign Key Constraint on User ID Update

**Problem:** Cannot update `users.id` because `analyses.user_id` and `recordings.user_id` reference it.

**Solution:** Never update user ID. Backend finds users by email and returns existing ID. Frontend uses database ID for all requests.

### OAuth ID Inconsistency

**Problem:** Google OAuth can generate different user IDs across sessions.

**Solution:** Use email as the source of truth. On login, find user by email and return their original database ID.

## Migrations

Migrations are in the `migrations/` folder:

1. `001_add_match_data.sql` - Add match data to analyses
2. `002_add_clips_column.sql` - Add clips column
3. `003_add_progress_columns.sql` - Add progress tracking
4. `004_add_users_table.sql` - Add users and link to analyses/recordings
5. `005_add_password_auth.sql` - Add password auth support
6. `006_remove_riot_puuid_unique.sql` - Allow multiple accounts per Riot ID

## Useful Commands

```bash
# Check database tables
npx wrangler d1 execute nexra-db --command "SELECT name FROM sqlite_master WHERE type='table';" --remote

# Check users
npx wrangler d1 execute nexra-db --command "SELECT id, email, riot_game_name FROM users;" --remote

# View worker logs
npx wrangler tail --format pretty
```
