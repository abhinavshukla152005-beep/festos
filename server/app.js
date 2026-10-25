import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from './agent.js';
import { diffPlans } from './planner.js';
import { liveModeAvailable } from './qloo.js';
import { paypalStatus } from './paypal.js';
import { draftSettlement, createSettlementOrders, captureSettlementOrder } from './settlement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use((req, res, next) => {
  const op = new URL(req.url, 'http://localhost').searchParams.get('op');
  if (op === 'health' || op === 'plan' || op === 'replan') {
    req.url = `/api/${op}`;
    return next();
  }
  const match = req.url.match(/\/(health|plan|replan)(\?.*)?$/);
  if (match) req.url = `/api/${match[1]}${match[2] || ''}`;
  next();
});

const api = express.Router();

function publicOrigin(req) {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8787')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

api.get('/health', (req, res) => {
  res.json({
    ok: true,
    liveQloo: liveModeAvailable,
    mode: liveModeAvailable ? 'live' : 'demo',
    paypal: paypalStatus(),
    time: new Date().toISOString(),
  });
});

api.post('/plan', async (req, res) => {
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

api.post('/replan', async (req, res) => {
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

api.post('/settlement/draft', (req, res) => {
  try {
    res.json(draftSettlement(req.body || {}));
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

api.post('/settlement/orders', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await createSettlementOrders({
      obligations: body.obligations,
      runId: body.runId,
      origin: publicOrigin(req),
    });
    res.json(result);
  } catch (err) {
    console.error('[settlement:orders]', err.message);
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

api.post('/settlement/capture', async (req, res) => {
  try {
    const result = await captureSettlementOrder({ orderId: req.body?.orderId });
    res.json(result);
  } catch (err) {
    console.error('[settlement:capture]', err.message);
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

app.use('/api', api);
app.use('/functions/v1/app', api);

const dist = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/functions/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      name: 'FestOS API',
      hint: 'Run `npm run dev` for the UI, or `npm run build` to serve the built app.',
      health: '/functions/v1/app/health',
    });
  });
}

export default app;
