# challengeiaback

Backend API for the Launch Signal Dashboard assessment.

## Stack
- Node.js
- Express
- Zod
- Supabase (primary persistence)
- Local JSON fallback for local development only

## What It Does
- Ingests launch URLs from X and LinkedIn
- Pulls X metrics (likes/comments/reposts)
- Finds matching LinkedIn launch posts and reactions when available
- Estimates funding amount from public sources (Crunchbase/YC/press snippets)
- Enriches contacts (email, phone, LinkedIn, X)
- Drafts outreach DMs for low-engagement launches

## API Endpoints
- `GET /api/health`
- `GET /api/launches`
- `GET /api/stats`
- `POST /api/ingest`
- `POST /api/draft-dms`
- `POST /api/reset`

### `POST /api/ingest` body
```json
{
  "urls": ["https://x.com/...", "https://www.linkedin.com/posts/..."],
  "limit": 25,
  "poorThreshold": 500
}
```

If `urls` is omitted, the backend uses preloaded challenge links from `src/data/seedLaunchUrls.js`.

## Local Run
```bash
npm install
cp .env.example .env
npm run start
```

API runs on `http://localhost:4000` by default.

## Supabase Setup
1. Create a Supabase project.
2. Run SQL from [`supabase/schema.sql`](./supabase/schema.sql).
3. Set backend env vars:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STATE_TABLE=app_state` (default)
- `SUPABASE_STORE_KEY=launch-dashboard-state` (default)
- `SUPABASE_MAX_RETRIES=3` (default)
- `SUPABASE_RETRY_BASE_MS=400` (default)
- `SUPABASE_LOCAL_FALLBACK_ON_ERROR=1` (local-dev fallback only)

Notes:
- On Vercel, Supabase is required.
- Without Supabase env vars, local dev falls back to `data/launches.json`.
- If Supabase has transient network/Cloudflare issues (for example 525), local dev auto-falls back to file store when `SUPABASE_LOCAL_FALLBACK_ON_ERROR=1`.

## Vercel Deployment
This repo is configured for Vercel serverless using:
- [`api/index.js`](./api/index.js)
- [`vercel.json`](./vercel.json)

Deploy steps:
1. Import repo in Vercel as a project.
2. Add environment variables from `.env.example` (especially Supabase vars).
3. Deploy.

Your API base URL will be:
- `https://<your-backend-project>.vercel.app`
