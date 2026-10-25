// @ts-nocheck
import { buildPlan } from './agent.js';
import { diffPlans } from './planner.js';
import { liveModeAvailable } from './qloo.js';

const MAX_BODY = 200_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const route = url.searchParams.get('op') || url.pathname.split('/').filter(Boolean).pop() || '';

  if (req.method === 'GET' && route === 'health') {
    return json({
      ok: true,
      liveQloo: liveModeAvailable,
      mode: liveModeAvailable ? 'live' : 'demo',
      time: new Date().toISOString(),
    });
  }

  if (req.method === 'POST' && (route === 'plan' || route === 'replan')) {
    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > MAX_BODY) return json({ error: 'Request body too large.' }, 413);

    let body: any;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: 'Request body too large.' }, 413);
      body = JSON.parse(text || '{}');
    } catch {
      return json({ error: 'Body must be valid JSON.' }, 400);
    }

    if (!Array.isArray(body?.seeds) || body.seeds.length === 0) {
      return json({ error: 'Body must include a non-empty "seeds" array.' }, 400);
    }
    if (body.seeds.length > 6) {
      return json({ error: 'Use at most 6 taste signals.' }, 400);
    }

    try {
      const result = await buildPlan(body);
      if (result.error) return json(result, 422);
      if (body.previousPlan) result.diff = diffPlans(body.previousPlan, result.plan);
      if (route === 'replan') {
        return json({ ...result, replanned: true, action: body.action || 'manual' });
      }
      return json(result);
    } catch (err) {
      console.error('[plan]', err?.message || err);
      return json(
        { error: 'The agent could not finish this plan. Try again or switch data source.' },
        500,
      );
    }
  }

  return json({ error: 'Not found.' }, 404);
});
