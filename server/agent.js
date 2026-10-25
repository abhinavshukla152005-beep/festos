import { createClient } from './qloo.js';
import { solve, validate } from './planner.js';

const SEARCH_TYPES = [
  { type: 'urn:entity:artist', kind: 'artist' },
  { type: 'urn:entity:movie', kind: 'movie' },
  { type: 'urn:entity:place', kind: 'place' },
];

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function nameScore(a, b) {
  const x = String(a || '').toLowerCase().trim();
  const y = String(b || '').toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.82;
  const tokens = x.split(/\s+/).filter((t) => t.length > 2);
  const hits = tokens.filter((t) => y.includes(t)).length;
  return hits ? 0.45 + (hits / Math.max(tokens.length, 1)) * 0.3 : 0;
}

function mergeCandidate(map, entity, seedName, rank) {
  const id = entity.entity_id || `${entity.name}-${seedName}`;
  const affinity = typeof entity.affinity === 'number' ? entity.affinity : null;
  const existing =
    map.get(id) ||
    {
      ...entity,
      entity_id: id,
      seeds: [],
      seedScores: {},
      rank,
      bestAffinity: null,
    };
  existing.rank = Math.min(existing.rank, rank);
  if (affinity != null) {
    existing.seedScores[seedName] = Math.max(existing.seedScores[seedName] ?? 0, affinity);
    if (existing.bestAffinity == null || affinity > existing.bestAffinity) existing.bestAffinity = affinity;
  }
  const qualifies = affinity != null ? affinity >= 0.55 : rank <= 2;
  if (qualifies && !existing.seeds.includes(seedName)) existing.seeds.push(seedName);
  map.set(id, existing);
}

function finalizeCandidates(map) {
  return [...map.values()].map((c) => {
    const best = c.bestAffinity;
    const seeds = c.seeds.filter(
      (seed) => best == null || (c.seedScores[seed] ?? 0) >= Math.max(0.55, best - 0.25),
    );
    return { ...c, seeds, affinity: best };
  });
}

export async function buildPlan(input = {}) {
  const trace = [];
  const startedAll = Date.now();
  const budgetInr = Math.min(Math.max(Number(input.budgetInr) || 4500000, 300000), 100000000);
  const maxPerTag = Math.min(Math.max(Number(input.maxPerTag) || 2, 1), 3);
  const rawSeeds = Array.isArray(input.seeds) ? input.seeds : [];
  const seeds = [...new Set(rawSeeds.map((s) => String(s).trim()).filter(Boolean))].slice(0, 6);
  const locationQuery = String(input.location || 'Kanpur, India').slice(0, 80);
  const excludeIds = new Set(Array.isArray(input.excludeIds) ? input.excludeIds : []);
  const forceDemo = input.mode === 'demo';

  if (seeds.length < 1) {
    return { error: 'Add at least one artist, movie or place your campus actually likes.' };
  }

  const client = createClient({ forceDemo });
  const step = async (id, title, fn) => {
    const t0 = Date.now();
    try {
      const result = await fn();
      trace.push({
        id,
        title,
        status: result?.status || 'ok',
        detail: result?.detail || '',
        chips: result?.chips || [],
        ms: Date.now() - t0,
      });
      return result;
    } catch (err) {
      trace.push({
        id,
        title,
        status: 'error',
        detail: err.message.slice(0, 240),
        chips: [],
        ms: Date.now() - t0,
      });
      throw err;
    }
  };

  await step('brief', 'Reading the campus brief', async () => ({
    detail: `${seeds.length} taste signals · ${formatBudget(budgetInr)} envelope · max ${maxPerTag} per genre`,
    chips: seeds,
  }));

  const resolved = await step('resolve', 'Resolving signals on Qloo', async () => {
    const tasks = [];
    for (const seed of seeds) {
      for (const { type, kind } of SEARCH_TYPES) {
        tasks.push({ seed, type, kind });
      }
    }
    const results = await mapLimit(tasks, 4, async (task) => {
      try {
        const rows = await client.search(task.seed, [task.type]);
        const ranked = rows
          .map((r) => ({ r, score: nameScore(task.seed, r.name) }))
          .sort((a, b) => b.score - a.score);
        return { ...task, best: ranked[0] && ranked[0].score >= 0.48 ? ranked[0] : null };
      } catch (err) {
        return { ...task, error: err.message, best: null };
      }
    });

    const bySeed = new Map();
    for (const row of results) {
      if (!row.best) continue;
      const current = bySeed.get(row.seed);
      if (!current || row.best.score > current.score) {
        bySeed.set(row.seed, { ...row.best.r, score: row.best.score, kind: row.kind });
      }
    }
    const resolvedSeeds = [...bySeed.entries()].map(([name, entity]) => ({ name, entity }));
    const unresolved = seeds.filter((s) => !bySeed.has(s));
    return {
      resolvedSeeds,
      unresolved,
      status: resolvedSeeds.length ? (unresolved.length ? 'warn' : 'ok') : 'error',
      detail: `${resolvedSeeds.length}/${seeds.length} signals resolved${
        unresolved.length ? ` · unresolved: ${unresolved.join(', ')}` : ''
      }`,
      chips: resolvedSeeds.map((s) => `${s.name} → ${s.entity.name}`),
    };
  });

  if (!resolved.resolvedSeeds.length) {
    return {
      error: 'None of those signals resolved on Qloo. Try well-known artist, movie or place names.',
      trace,
      meta: { mode: client.mode, note: client.note },
    };
  }

  const candidateMaps = { artist: new Map(), movie: new Map(), place: new Map() };

  await step('taste', 'Pulling audience affinities', async () => {
    const jobs = [];
    for (const { entity } of resolved.resolvedSeeds) {
      for (const kind of ['artist', 'movie', 'place']) {
        jobs.push({ seedEntity: entity, kind });
      }
    }
    const results = await mapLimit(jobs, 4, async ({ seedEntity, kind }) => {
      const type = `urn:entity:${kind}`;
      try {
        const take = kind === 'artist' ? 12 : kind === 'movie' ? 8 : 10;
        const rows = await client.insights(type, seedEntity, {
          take,
          locationQuery: kind === 'place' ? locationQuery : undefined,
        });
        return { rows, kind, seedName: seedEntity.name };
      } catch (err) {
        return { rows: [], kind, seedName: seedEntity.name, error: err.message };
      }
    });

    for (const { rows, kind, seedName } of results) {
      rows.forEach((row, index) => mergeCandidate(candidateMaps[kind], row, seedName, index));
    }
    const counts = {
      artists: candidateMaps.artist.size,
      movies: candidateMaps.movie.size,
      places: candidateMaps.place.size,
    };
    const noRows = counts.artists + counts.movies + counts.places === 0;
    return {
      counts,
      status: noRows ? 'error' : 'ok',
      detail: noRows
        ? 'Qloo returned no candidates for these signals.'
        : `${counts.artists} artists · ${counts.movies} movies · ${counts.places} local experiences`,
      chips: [
        `signals: ${resolved.resolvedSeeds.map((s) => s.entity.name).join(', ')}`,
        `location: ${locationQuery}`,
      ],
    };
  });

  const candidates = {
    artists: finalizeCandidates(candidateMaps.artist).filter((c) => !excludeIds.has(c.entity_id)),
    movies: finalizeCandidates(candidateMaps.movie).filter((c) => !excludeIds.has(c.entity_id)),
    places: finalizeCandidates(candidateMaps.place).filter((c) => !excludeIds.has(c.entity_id)),
  };

  const solved = await step('plan', 'Solving the lineup', async () => {
    const result = solve({ candidates, budgetInr, maxPerTag, minAffinity: 0.4 });
    if (result.error) {
      return { status: 'error', detail: result.error };
    }
    return {
      result,
      detail: `Checked ${result.solver.combosChecked.toLocaleString('en-IN')} feasible combinations in ${
        result.solver.ms
      } ms`,
      chips: [
        `avg affinity ${result.totals.avgAffinity.toFixed(2)}`,
        `${result.totals.artistTags.length} artist genres`,
        `${result.totals.cuisines.length} cuisines`,
      ],
    };
  });

  if (!solved.result) {
    return {
      error: solved.detail || 'No feasible lineup found.',
      trace,
      meta: { mode: client.mode, note: client.note },
    };
  }

  const plan = solved.result;
  await step('validate', 'Validating constraints', async () => {
    plan.checks = validate(plan, { budgetInr, maxPerTag });
    const failed = plan.checks.filter((c) => !c.pass);
    return {
      status: failed.length ? 'warn' : 'ok',
      detail: failed.length ? failed.map((c) => c.label).join(' · ') : 'All constraints satisfied',
      chips: plan.checks.map((c) => `${c.pass ? '✓' : '!'} ${c.label}`),
    };
  });

  await step('narrate', 'Writing the run of show', async () => ({
    detail: `${plan.lineup.length} slots · ${formatBudget(plan.totals.feeInr)} committed · ${formatBudget(
      plan.totals.remainingInr,
    )} held back`,
    chips: plan.lineup.slice(0, 3).map((p) => p.name),
  }));

  trace.push({
    id: 'done',
    title: 'Lineup ready',
    status: 'ok',
    detail: `Finished in ${((Date.now() - startedAll) / 1000).toFixed(1)} s`,
    chips: [],
    ms: 0,
  });

  return {
    plan: {
      ...plan,
      headline: buildHeadline(plan),
      generatedAt: new Date().toISOString(),
    },
    trace,
    meta: {
      mode: client.mode,
      note: client.note,
      location: locationQuery,
      budgetInr,
      maxPerTag,
      seeds: resolved.resolvedSeeds.map((s) => ({
        query: s.name,
        resolved: s.entity.name,
        kind: s.kind,
      })),
      unresolved: resolved.unresolved,
      calls: client.stats.calls,
      toolCalls: client.stats.toolCalls,
      cacheHits: client.stats.cacheHits || 0,
      failures: client.stats.failures,
      candidateCounts: {
        artists: candidates.artists.length,
        movies: candidates.movies.length,
        places: candidates.places.length,
      },
      solverMs: plan.solver.ms,
      feasibilityChecks: plan.solver.combosChecked,
    },
  };
}

function buildHeadline(plan) {
  const headliner = plan.lineup.find((p) => p.role === 'headliner');
  const genres = plan.totals.artistTags.slice(0, 3).join(' / ');
  return `${headliner ? headliner.name : 'Lineup'} tops a ${plan.lineup.length}-slot night across ${genres}.`;
}

function formatBudget(amount) {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}
