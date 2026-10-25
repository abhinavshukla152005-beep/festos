import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from './agent.js';
import { diffPlans } from './planner.js';
import { liveModeAvailable } from './qloo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 8787;

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    liveQloo: liveModeAvailable,
    mode: liveModeAvailable ? 'live' : 'demo',
    time: new Date().toISOString(),
  });
});

app.post('/api/plan', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.seeds) || body.seeds.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty "seeds" array.' });
    }
    if (body.seeds.length > 6) {
      return res.status(400).json({ error: 'Use at most 6 taste signals.' });
    }
    const result = await buildPlan(body);
    if (result.error) {
      return res.status(422).json(result);
    }
    if (body.previousPlan) {
      result.diff = diffPlans(body.previousPlan, result.plan);
    }
    res.json(result);
  } catch (err) {
    console.error('[plan]', err);
    res.status(500).json({ error: 'The agent could not finish this plan. Try again or switch data source.' });
  }
});

app.post('/api/replan', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.seeds) || body.seeds.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty "seeds" array.' });
    }
    const result = await buildPlan(body);
    if (result.error) return res.status(422).json(result);
    if (body.previousPlan) {
      result.diff = diffPlans(body.previousPlan, result.plan);
    }
    res.json({ ...result, replanned: true, action: body.action || 'manual' });
  } catch (err) {
    console.error('[replan]', err);
    res.status(500).json({ error: 'Re-planning failed. Try again.' });
  }
});

const dist = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      name: 'FestOS API',
      hint: 'Run `npm run dev` for the UI, or `npm run build` to serve the built app.',
      health: '/api/health',
    });
  });
}

app.listen(PORT, () => {
  console.log(`FestOS API on http://localhost:${PORT} (${liveModeAvailable ? 'live Qloo' : 'demo data'})`);
});
