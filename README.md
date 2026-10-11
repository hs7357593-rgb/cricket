# CricketZone
1. `cd server && cp .env.example .env` (add CRICAPI_KEY from cricapi.com, optional MONGO_URI) → `npm i && npm run dev`
2. `cd client && npm i && npm run dev` → http://localhost:5173 (proxies /api to :5000)
Free API tiers are rate-limited; the server caches 20s and falls back to MongoDB snapshots.
