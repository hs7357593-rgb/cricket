import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

const { CRICAPI_KEY, MONGO_URI, PORT = 5000 } = process.env;
const BASE = 'https://api.cricapi.com/v1';
const app = express();
app.use(cors());

// Optional MongoDB snapshot store: serves last known data if the API is down/rate-limited.
const Snapshot = mongoose.model('Snapshot', new mongoose.Schema(
  { key: { type: String, unique: true }, data: mongoose.Schema.Types.Mixed },
  { timestamps: true }));
let dbReady = false;
if (MONGO_URI) mongoose.connect(MONGO_URI).then(() => (dbReady = true)).catch(e => console.warn('Mongo off:', e.message));

const cache = new Map(); // key -> {t, data}
async function cricapi(path, params = {}, ttl = 20000) {
  const key = path + JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  try {
    if (!CRICAPI_KEY) throw new Error('No CRICAPI_KEY set');
    const qs = new URLSearchParams({ apikey: CRICAPI_KEY, ...params });
    const r = await fetch(`${BASE}/${path}?${qs}`);
    const j = await r.json();
    if (j.status !== 'success') throw new Error(j.reason || 'API error');
    cache.set(key, { t: Date.now(), data: j.data });
    if (dbReady) Snapshot.updateOne({ key }, { data: j.data }, { upsert: true }).catch(() => {});
    return j.data;
  } catch (e) {
    if (dbReady) { const s = await Snapshot.findOne({ key }); if (s) return s.data; }
    throw e;
  }
}

// Normalise a CricAPI match into a status bucket the UI can badge.
function normalise(m) {
  const s = (m.status || '').toLowerCase();
  let state = 'upcoming';
  if (m.matchEnded) state = 'completed';
  else if (m.matchStarted) state = /delay|rain|abandon|stump|interrupt/.test(s) ? 'delayed' : 'live';
  return { ...m, state };
}

app.get('/api/matches', async (_req, res) => {
  try { res.json((await cricapi('currentMatches', { offset: 0 })).map(normalise)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/matches/:id', async (req, res) => {
  try {
    const [info, card] = await Promise.all([
      cricapi('match_info', { id: req.params.id }),
      cricapi('match_scorecard', { id: req.params.id }).catch(() => null),
    ]);
    res.json({ ...normalise(info), scorecard: card?.scorecard || [] });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ matches: [], players: [] });
  try {
    const [matches, players] = await Promise.all([
      cricapi('currentMatches', { offset: 0 }),
      cricapi('players', { search: q }, 60000),
    ]);
    res.json({ matches: matches.filter(m => m.name.toLowerCase().includes(q.toLowerCase())).map(normalise), players });
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/series', async (_req, res) => {
  try { res.json(await cricapi('series', { offset: 0 }, 300000)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, db: dbReady }));

app.listen(PORT, () => console.log(`CricketZone API on :${PORT}`));
