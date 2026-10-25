// Constraint planner for a one-night campus fest.
//
// Fees are *modelled planning weights*, not quotes: demo entries carry a
// synthetic fee, live entries derive one from Qloo affinity + a deterministic
// jitter. The UI labels them "modelled" everywhere.

const LAKH = 100000;

const FEE_BANDS = {
  artist: { base: 1.4, max: 24 },
  movie: { base: 0.35, max: 1.4 },
  place: { base: 0.22, max: 0.95 },
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function scoreOf(entity) {
  if (typeof entity.affinity === 'number') return entity.affinity;
  const rank = Number.isFinite(entity.rank) ? entity.rank : 10;
  return Math.max(0.35, 0.9 - rank * 0.035);
}

export function feeFor(entity, kind) {
  if (typeof entity.feeLakh === 'number' && entity.feeLakh > 0) {
    return Math.round(entity.feeLakh * LAKH);
  }
  const band = FEE_BANDS[kind] || FEE_BANDS.artist;
  const a = scoreOf(entity);
  const jitter = 0.82 + hash(entity.entity_id || entity.name) * 0.36;
  const lakh = band.base + (band.max - band.base) * a ** 1.7 * jitter;
  return Math.round(lakh * LAKH);
}

function primaryTag(entity) {
  return (entity.tags && entity.tags[0]) || 'uncharted';
}

function combos(items, k) {
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function artistCombos(pool, maxPerTag, k) {
  return combos(pool, k).filter((set) => {
    if (k < 3) return true;
    const counts = new Map();
    for (const a of set) {
      const tag = primaryTag(a);
      counts.set(tag, (counts.get(tag) || 0) + 1);
      if (counts.get(tag) > maxPerTag) return false;
    }
    return true;
  });
}

function vendorCombos(pool, k) {
  return combos(pool, k).filter((set) => {
    const cuisines = new Set(set.map((p) => primaryTag(p)));
    return cuisines.size === set.length || k < 3;
  });
}

function decorate(entity, kind, role) {
  const { cost, sc, ...clean } = entity;
  const feeInr = typeof cost === 'number' ? cost : feeFor(entity, kind);
  const why =
    entity.seeds && entity.seeds.length
      ? `Qloo tied this to your campus signals: ${entity.seeds.slice(0, 3).join(' · ')}`
      : `Ranked #${(entity.rank ?? 0) + 1} on Qloo for this campus profile`;
  return {
    ...clean,
    kind,
    role,
    feeInr,
    why,
    score: Number((typeof sc === 'number' ? sc : scoreOf(entity)).toFixed(3)),
  };
}

function evaluate({ artistSet, movie, vendorSet, budgetInr }) {
  const headliner = artistSet[0];
  const supports = artistSet.slice(1);
  const artists = [headliner, ...supports];
  const picks = [
    decorate(headliner, 'artist', 'headliner'),
    ...supports.map((s, i) => decorate(s, 'artist', i === 0 ? 'support' : 'opener')),
    movie ? decorate(movie, 'movie', 'screening') : null,
    ...vendorSet.map((v) => decorate(v, 'place', 'food')),
  ].filter(Boolean);

  const feeInr = picks.reduce((sum, p) => sum + p.feeInr, 0);
  if (feeInr > budgetInr) return null;

  const affinity = picks.reduce((sum, p) => sum + p.score, 0) / picks.length;
  const artistTags = new Set(artists.map(primaryTag));
  const cuisines = new Set(vendorSet.map(primaryTag));
  const diversityArtists = artistTags.size / Math.max(1, artists.length);
  const diversityFood = cuisines.size / Math.max(1, vendorSet.length);
  const spendRatio = feeInr / budgetInr;
  const budgetFit = Math.max(0, 1 - Math.abs(spendRatio - 0.86) * 2.2);
  const headlinerScore = headliner.sc;

  const objective =
    0.5 * affinity +
    0.16 * headlinerScore +
    0.14 * (0.55 * diversityArtists + 0.45 * diversityFood) +
    0.2 * budgetFit;

  return {
    picks,
    feeInr,
    affinity,
    objective,
    diversity: {
      artistTags: [...artistTags],
      cuisines: [...cuisines],
    },
  };
}

export function solve({ candidates, budgetInr, maxPerTag = 2, minAffinity = 0.4 }) {
  const started = Date.now();
  const prep = (entity, kind) => ({ ...entity, cost: feeFor(entity, kind), sc: scoreOf(entity) });
  const byScore = (a, b) => b.sc - a.sc;
  const artists = candidates.artists
    .filter((a) => scoreOf(a) >= minAffinity)
    .map((a) => prep(a, 'artist'))
    .sort(byScore)
    .slice(0, 14);
  const movies = candidates.movies
    .filter((m) => scoreOf(m) >= minAffinity)
    .map((m) => prep(m, 'movie'))
    .sort(byScore)
    .slice(0, 6);
  const places = candidates.places
    .filter((p) => scoreOf(p) >= minAffinity)
    .map((p) => prep(p, 'place'))
    .sort(byScore)
    .slice(0, 9);

  if (artists.length < 2) {
    return { error: 'Not enough artist candidates to build a lineup. Add broader seeds or switch data source.' };
  }

  const warnings = [];
  let best = null;
  let combosChecked = 0;

  const tryTier = (artistCount, vendorCount, movieOn) => {
    const aSets = artistCombos(artists, maxPerTag, Math.min(artistCount, artists.length));
    const vSets = vendorCombos(places, Math.min(vendorCount, places.length));
    const moviePool = movieOn && movies.length ? movies : [null];
    for (const artistSet of aSets) {
      const ordered = artistSet.slice().sort(byScore);
      const artistCost = ordered.reduce((sum, a) => sum + a.cost, 0);
      if (artistCost > budgetInr) continue;
      for (const movie of moviePool) {
        const movieCost = movie ? movie.cost : 0;
        if (artistCost + movieCost > budgetInr) continue;
        for (const vendorSet of vSets) {
          combosChecked += 1;
          const vendorCost = vendorSet.reduce((sum, v) => sum + v.cost, 0);
          if (artistCost + movieCost + vendorCost > budgetInr) continue;
          const result = evaluate({ artistSet: ordered, movie, vendorSet, budgetInr });
          if (result && (!best || result.objective > best.objective)) best = result;
        }
      }
    }
  };

  tryTier(3, 3, true);
  if (!best) {
    tryTier(3, 2, true);
    if (best) warnings.push('Budget could not cover three food vendors — reduced the food row to two.');
  }
  if (!best) {
    tryTier(2, 2, true);
    if (best) warnings.push('Budget is tight: built a two-act lineup with two vendors.');
  }
  if (!best) {
    tryTier(2, 2, false);
    if (best) warnings.push('Budget is very tight: dropped the movie screening.');
  }
  if (!best) {
    return { error: 'No feasible lineup fits this budget. Raise the budget or relax the affinity floor.' };
  }

  const times = {
    food: '4:00 PM',
    opener: '5:15 PM',
    support: '6:30 PM',
    headliner: '7:45 PM',
    movie: '9:30 PM',
  };

  const lineup = [];
  const foods = best.picks.filter((p) => p.role === 'food');
  foods.forEach((f, i) =>
    lineup.push({
      ...f,
      slot: `food${i + 1}`,
      label: 'Food row',
      time: times.food,
      stage: `Stall ${String.fromCharCode(65 + i)}`,
    }),
  );
  for (const p of best.picks.filter((p) => p.kind === 'artist')) {
    lineup.push({
      ...p,
      slot: p.role,
      label: p.role === 'headliner' ? 'Headliner' : p.role === 'support' ? 'Support act' : 'Opener',
      time: times[p.role],
      stage: 'Main stage',
    });
  }
  if (best.picks.some((p) => p.kind === 'movie')) {
    const movie = best.picks.find((p) => p.kind === 'movie');
    lineup.push({
      ...movie,
      slot: 'movie',
      label: 'Movie under the stars',
      time: times.movie,
      stage: 'Open-air screen',
    });
  }

  lineup.sort((a, b) => {
    const order = ['food1', 'food2', 'food3', 'opener', 'support', 'headliner', 'movie'];
    return order.indexOf(a.slot) - order.indexOf(b.slot);
  });

  const remainingInr = budgetInr - best.feeInr;
  return {
    lineup,
    totals: {
      feeInr: best.feeInr,
      budgetInr,
      remainingInr,
      spendRatio: best.feeInr / budgetInr,
      avgAffinity: Number(best.affinity.toFixed(3)),
      artistTags: best.diversity.artistTags,
      cuisines: best.diversity.cuisines,
    },
    warnings,
    solver: { combosChecked, ms: Date.now() - started },
  };
}

export function validate(plan, { budgetInr, maxPerTag = 2, minAffinity = 0.4 }) {
  const checks = [];
  const artists = plan.lineup.filter((p) => p.kind === 'artist');
  const foods = plan.lineup.filter((p) => p.role === 'food');
  const tagCounts = new Map();
  for (const a of artists) {
    const tag = primaryTag(a);
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const overCap = [...tagCounts.entries()].filter(([, n]) => n > maxPerTag);

  checks.push({
    id: 'budget',
    label: 'Budget',
    pass: plan.totals.feeInr <= budgetInr,
    detail: `${formatInr(plan.totals.feeInr)} committed of ${formatInr(budgetInr)} (${Math.round(
      plan.totals.spendRatio * 100,
    )}% envelope)`,
  });
  checks.push({
    id: 'diversity',
    label: 'Genre spread',
    pass: overCap.length === 0 && new Set(artists.map(primaryTag)).size >= Math.min(2, artists.length),
    detail: overCap.length
      ? `${overCap.map(([t, n]) => `${t} ×${n}`).join(', ')} exceeds the ${maxPerTag}-per-genre cap`
      : `${new Set(artists.map(primaryTag)).size} genres across ${artists.length} acts`,
  });
  checks.push({
    id: 'food',
    label: 'Vendor spread',
    pass: new Set(foods.map(primaryTag)).size === foods.length,
    detail: `${new Set(foods.map(primaryTag)).size} cuisines across ${foods.length} stalls`,
  });
  checks.push({
    id: 'affinity',
    label: 'Taste floor',
    pass: plan.totals.avgAffinity >= minAffinity,
    detail: `Average affinity ${plan.totals.avgAffinity.toFixed(2)} vs floor ${minAffinity.toFixed(2)}`,
  });
  checks.push({
    id: 'slots',
    label: 'Run of show',
    pass: plan.lineup.filter((p) => p.kind === 'artist').length >= 2 && foods.length >= 2,
    detail: `${plan.lineup.length} slots filled`,
  });
  return checks;
}

export function diffPlans(previous, next) {
  if (!previous) return { changes: [], dropped: [] };
  const before = new Map(previous.lineup.map((p) => [p.slot, p]));
  const changes = next.lineup.map((p) => {
    const old = before.get(p.slot);
    if (!old) return { slot: p.slot, label: p.label, name: p.name, status: 'new' };
    if (old.entity_id === p.entity_id) return { slot: p.slot, label: p.label, name: p.name, status: 'kept' };
    return { slot: p.slot, label: p.label, name: p.name, previous: old.name, status: 'changed' };
  });
  const nextIds = new Set(next.lineup.map((p) => p.entity_id));
  const dropped = previous.lineup
    .filter((p) => !nextIds.has(p.entity_id))
    .map((p) => ({ slot: p.slot, label: p.label, name: p.name }));
  return { changes, dropped };
}

export function formatInr(amount) {
  if (!Number.isFinite(amount)) return '—';
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export { primaryTag };
