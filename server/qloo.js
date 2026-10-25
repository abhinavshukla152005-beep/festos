import 'dotenv/config';
import { demoSearch, demoInsights } from './demo.js';

const KEY = (process.env.QLOO_API_KEY || '').trim();
const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, '');
const TIMEOUT_MS = 15000;

export const liveModeAvailable = Boolean(KEY);

const KINDS = {
  'urn:entity:artist': 'artist',
  'urn:entity:movie': 'movie',
  'urn:entity:place': 'place',
};

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function tagLabel(tag) {
  if (typeof tag === 'string') {
    const parts = tag.split(':');
    return parts[parts.length - 1].replace(/_/g, ' ');
  }
  return tag?.name || tag?.label || tag?.title || tag?.value || tag?.id || '';
}

function normalizeTagList(raw) {
  return toArray(raw)
    .map(tagLabel)
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractAffinity(entity) {
  const props = entity.properties || {};
  for (const candidate of [entity.affinity, props.affinity, entity.score, props.score]) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return null;
}

function normalizeEntity(entity, kind) {
  const props = entity.properties || {};
  const tags = normalizeTagList(entity.tags ?? props.tags ?? props.genres ?? props.cuisines);
  return {
    entity_id: entity.entity_id || entity.id || entity.uuid,
    name: entity.name || props.name || 'Unnamed',
    subtype: entity.subtype || `urn:entity:${kind}`,
    tags,
    affinity: extractAffinity(entity),
    popularity: Number(props.popularity ?? entity.popularity) || null,
    image: props.image?.url || entity.image?.url || null,
    blurb: props.description || props.short_description || null,
    feeLakh: null,
    demo: false,
  };
}

export function createClient({ forceDemo = false } = {}) {
  const mode = !KEY || forceDemo ? 'demo' : 'live';
  const note =
    mode === 'demo'
      ? forceDemo
        ? 'Demo data requested — affinity scores and fees are synthetic.'
        : 'QLOO_API_KEY is not configured — running on clearly-labelled demo data.'
      : null;

  const stats = { calls: 0, failures: 0, cacheHits: 0, toolCalls: 0 };
  const cache = new Map();
  const CACHE_TTL_MS = 5 * 60 * 1000;

  async function liveGet(path, params) {
    const url = new URL(`${BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === '') continue;
      const out = Array.isArray(value) ? value.join(',') : String(value);
      if (out) url.searchParams.set(key, out);
    }
    const cacheKey = `${path}?${url.searchParams.toString()}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      stats.cacheHits += 1;
      return { data: hit.data, ms: 0, url: cacheKey, cached: true };
    }
    const started = Date.now();
    stats.calls += 1;
    const res = await fetch(url, {
      headers: { 'X-Api-Key': KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      stats.failures += 1;
      let body = '';
      try {
        body = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      const err = new Error(`Qloo ${path} returned ${res.status}${body ? `: ${body}` : ''}`);
      err.status = res.status;
      err.ms = ms;
      throw err;
    }
    const data = await res.json();
    cache.set(cacheKey, { data, at: Date.now() });
    return { data, ms, url: cacheKey };
  }

  async function search(query, types) {
    stats.toolCalls += 1;
    const kind = KINDS[types[0]] || 'artist';
    if (mode === 'demo') {
      const rows = await demoSearch(query, types);
      return rows.map((r) => ({ ...r, feeLakh: r.feeLakh ?? null }));
    }
    const { data } = await liveGet('/search', {
      query,
      types,
      take: 3,
      sort_by: 'match',
    });
    const rows = Array.isArray(data.results) ? data.results : data.results?.entities || [];
    return rows.map((r) => normalizeEntity(r, kind));
  }

  async function insights(filterType, seed, { take = 10, locationQuery, signalTag } = {}) {
    stats.toolCalls += 1;
    const kind = KINDS[filterType] || 'artist';
    if (mode === 'demo') {
      return demoInsights(filterType, { seedName: seed?.name || seed?.entity_id, take });
    }
    const params = {
      'filter.type': filterType,
      take,
      sort_by: 'affinity',
    };
    if (seed?.entity_id) params['signal.interests.entities'] = [seed.entity_id];
    if (signalTag) params['signal.interests.tags'] = [signalTag];
    if (locationQuery) params['signal.location.query'] = locationQuery;
    const { data } = await liveGet('/v2/insights', params);
    const rows = data.results?.entities || (Array.isArray(data.results) ? data.results : []);
    return rows.map((r) => normalizeEntity(r, kind));
  }

  async function searchTags(query, take = 8) {
    stats.toolCalls += 1;
    if (mode === 'demo') return [];
    const { data } = await liveGet('/v2/tags', { 'filter.query': query, take });
    const rows = Array.isArray(data.results) ? data.results : data.results?.tags || [];
    return rows.map((t) => ({
      id: t.tag_id || t.id,
      name: tagLabel(t),
    }));
  }

  return { mode, note, stats, search, insights, searchTags };
}
