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

const CUISINE_RULES = [
  ['Biryani', /biryani|hyderabadi/i],
  ['South Indian', /south indian|dosa|idli|uttapam/i],
  ['Mughlai', /mughlai|kebab|tandoori|nihari/i],
  ['Indian', /indian|thali|paneer|curry/i],
  ['Chinese', /chinese|noodle|manchurian|dim sum/i],
  ['Italian', /italian|pizza|pasta/i],
  ['Continental', /continental/i],
  ['Bakery', /bakery|patisserie|cake shop/i],
  ['Desserts', /dessert|ice cream|sweets|mithai/i],
  ['Café', /cafe|coffee|espresso|chai/i],
  ['Burgers', /burger/i],
  ['Chaat', /chaat|street food/i],
  ['Grill', /grill|barbecue|bbq/i],
  ['Oriental', /thai|sushi|asian|oriental/i],
  ['Mexican', /mexican|taco/i],
  ['Bar food', /pub\b|brewery|lounge/i],
];
const FOOD_WORDS = /restaurant|cafe|coffee|food|kitchen|dine|eatery|dhaba|canteen|bakery|bar\b|pub\b|lounge|sweets|dessert|biryani|pizza|burger|chaat/i;

function classifyPlace(place) {
  const hay = `${place.name || ''} ${place.blurb || ''} ${(place.tags || []).join(' ')}`;
  const match = CUISINE_RULES.find(([, re]) => re.test(hay));
  return { cuisine: match ? match[0] : null, food: FOOD_WORDS.test(hay) };
}

const GENRE_WORDS = /indie|pop\b|rock|bollywood|filmi|playback|qawwali|sufi|classical|folk|fusion|jazz|blues|metal|punk|hip hop|rap\b|electronic|edm\b|house\b|techno|soul|r&b|ghazal|devotional|bhangra|acoustic|country|reggae|latin|soundtrack|ambient|orchestral|trap\b|afrobeats|lo-fi|disco|funk|gospel|opera|carnatic|hindustani|semiclassical/i;

function withGenre(entity, kind) {
  if (kind !== 'artist') return entity;
  const genre = (entity.tags || []).find((tag) => GENRE_WORDS.test(tag));
  return genre ? { ...entity, genre } : entity;
}

function foodPlaces(rows) {
  const tagged = rows.map((row) => {
    const { cuisine, food } = classifyPlace(row);
    const tags = cuisine
      ? [cuisine, ...(row.tags || []).filter((tag) => tag !== cuisine)]
      : row.tags;
    return { row: cuisine ? { ...row, cuisine, tags } : row, food };
  });
  const edible = tagged.filter((t) => t.food);
  return (edible.length ? edible : tagged).map((t) => t.row);
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
  const diagnostics = { insightErrors: [], resolveErrors: [] };
  const baseMeta = () => ({
    mode: client.mode,
    note: client.note,
    insightErrors: diagnostics.insightErrors.slice(0, 4),
    resolveErrors: diagnostics.resolveErrors.slice(0, 4),
    qlooErrors: client.stats.errors.slice(0, 4),
    calls: client.stats.calls,
    toolCalls: client.stats.toolCalls,
    failures: client.stats.failures,
  });
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
    const results = await mapLimit(tasks, 3, async (task) => {
      try {
        const rows = await client.search(task.seed, [task.type]);
        const ranked = rows
          .map((r) => {
            const name = nameScore(task.seed, r.name);
            const pop = Number.isFinite(r.popularity) ? r.popularity : 0.4;
            return { r, name, score: name * (0.55 + 0.45 * pop) };
          })
          .filter((row) => row.name >= 0.48)
          .sort((a, b) => b.score - a.score);
        return { ...task, best: ranked[0] || null };
      } catch (err) {
        diagnostics.resolveErrors.push(`${task.kind} "${task.seed}": ${err.message}`);
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
      }${diagnostics.resolveErrors.length ? ` · ${diagnostics.resolveErrors.length} search errors` : ''}`,
      chips: resolvedSeeds.map((s) => `${s.name} → ${s.entity.name} (${s.entity.kind})`),
    };
  });

  if (!resolved.resolvedSeeds.length) {
    return {
      error: 'None of those signals resolved on Qloo. Try well-known artist, movie or place names.',
      trace,
      meta: baseMeta(),
    };
  }

  const candidateMaps = { artist: new Map(), movie: new Map(), place: new Map() };
  const city = locationQuery.split(',')[0].trim();
  let placeFallbackUsed = false;

  await step('taste', 'Pulling audience affinities', async () => {
    const jobs = [];
    for (const { entity } of resolved.resolvedSeeds) {
      for (const kind of ['artist', 'movie', 'place']) {
        jobs.push({ seedEntity: entity, kind });
      }
    }
    const deadlineAt = Date.now() + 38000;
    const results = await mapLimit(jobs, 2, async ({ seedEntity, kind }) => {
      const type = `urn:entity:${kind}`;
      try {
        const take = kind === 'artist' ? 12 : kind === 'movie' ? 8 : 10;
        let rows = await client.insights(type, seedEntity, {
          take,
          city: kind === 'place' ? city : undefined,
          deadlineAt,
        });
        let fellBack = false;
        if (kind === 'place' && city && rows.length === 0) {
          rows = await client.insights(type, seedEntity, { take, deadlineAt });
          fellBack = rows.length > 0;
        }
        if (kind === 'place') rows = foodPlaces(rows);
        return { rows, kind, seedName: seedEntity.name, fellBack };
      } catch (err) {
        diagnostics.insightErrors.push(`${kind} from "${seedEntity.name}": ${err.message}`);
        return { rows: [], kind, seedName: seedEntity.name, error: err.message };
      }
    });

    for (const { rows, kind, seedName, fellBack } of results) {
      if (fellBack) placeFallbackUsed = true;
      rows.forEach((row, index) =>
        mergeCandidate(candidateMaps[kind], withGenre(row, kind), seedName, index),
      );
    }
    const counts = {
      artists: candidateMaps.artist.size,
      movies: candidateMaps.movie.size,
      places: candidateMaps.place.size,
    };
    const failed = diagnostics.insightErrors.length;
    const noRows = counts.artists + counts.movies + counts.places === 0;
    return {
      counts,
      status: noRows ? 'error' : 'ok',
      detail: noRows
        ? diagnostics.insightErrors[0] || 'Qloo returned no candidates for these signals.'
        : `${counts.artists} artists · ${counts.movies} movies · ${counts.places} local experiences${
            failed ? ` · ${failed}/${jobs.length} insight calls failed` : ''
          }${placeFallbackUsed ? ' · broader venue scope' : ''}`,
      chips: [
        `signals: ${resolved.resolvedSeeds.map((s) => s.entity.name).join(', ')}`,
        placeFallbackUsed ? `venues: broader affinity (no ${city} venues)` : `venues: ${city}`,
        failed ? `Qloo: ${failed}/${jobs.length} calls failed (retried)` : null,
        noRows && diagnostics.insightErrors[0] ? `error: ${diagnostics.insightErrors[0]}` : null,
      ].filter(Boolean),
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
      meta: {
        ...baseMeta(),
        candidateCounts: {
          artists: candidates.artists.length,
          movies: candidates.movies.length,
          places: candidates.places.length,
        },
        candidatesWithoutAffinity: [
          ...candidates.artists,
          ...candidates.movies,
          ...candidates.places,
        ].filter((c) => c.affinity == null).length,
      },
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
    chips: plan.lineup.filter((p) => p.kind === 'artist').map((p) => p.name),
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
      ...baseMeta(),
      location: locationQuery,
      placeScope: placeFallbackUsed ? 'broader' : 'local',
      budgetInr,
      maxPerTag,
      seeds: resolved.resolvedSeeds.map((s) => ({
        query: s.name,
        resolved: s.entity.name,
        resolvedId: s.entity.entity_id,
        kind: s.entity.kind,
      })),
      unresolved: resolved.unresolved,
      cacheHits: client.stats.cacheHits || 0,
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
