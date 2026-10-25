# FestOS

**A taste-aware planning agent for campus fests, built on the Qloo cultural taste graph.**

Give FestOS a handful of things your campus actually loves — an artist, a film, a place students hang out at — and it returns a complete run of show: headliner, support acts, a late-night screening, and a food row, all chosen to fit a real budget and a deliberate genre mix.

Built solo for the [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/).

**Live app:** <https://festos-abhinav-shukla1.vercel.app/> · **Source:** <https://github.com/abhinavshukla152005-beep/festos>

![FestOS desktop UI](docs/festos-desktop.png)

*One run in demo mode: a Kanpur campus brief resolved into a headliner, support acts, a late-night film and a food row — with the full agent trace open.*

---

## The problem

Campus fest committees plan lineups from last year's list and a WhatsApp poll. The result is predictable: one expensive headliner, three acts that sound the same, a food row nobody visits, and no plan B when the headliner cancels two weeks out.

FestOS treats a lineup as a **cultural-fit problem under constraints**, not a wishlist. Qloo supplies the taste signal; a deterministic solver does the trade-offs; the agent shows every step.

## What one run does

1. **Resolve.** Each taste signal is searched against Qloo's entity graph (`/search`) across artists, movies, and places. Matches below a similarity floor are discarded and reported.
2. **Read taste.** For every resolved signal, FestOS asks Qloo Insights (`/v2/insights`) for affinity-ranked artists, films, and local places near the campus. Candidates are merged and tagged with the signals that surfaced them.
3. **Solve.** A constrained search evaluates hundreds of feasible lineups (3 acts, 1 film, 3 vendors) against budget, a per-genre cap, distinct cuisines, and an affinity floor, then keeps the best-scoring feasible combination.
4. **Validate and explain.** Every constraint is re-checked and printed. Each slot carries a *why* line pointing back to the campus signals that produced it.
5. **Re-plan.** One click simulates a headliner dropping out, a 25% budget cut, or a stricter genre cap. The new plan is diffed against the old one — kept, switched, new, dropped.

## Qloo API usage

| Purpose | Endpoint |
| --- | --- |
| Resolve a signal to an entity | `GET /search?query=…&types=urn:entity:artist` |
| Affinity-ranked candidates | `GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=…` |
| Local place candidates | `GET /v2/insights?filter.type=urn:entity:place&filter.location.query=Kanpur&signal.interests.entities=…` |

Notes:

- Only documented parameters are sent. If a city has no Qloo place coverage, the place lookup retries once without the location filter and the trace says so (`placeScope: broader`).
- Base URL is **`https://hackathon.api.qloo.com`**; the key travels in the `X-Api-Key` header.
- All Qloo traffic happens **server-side**. The browser never sees the key.
- Responses are cached in a private in-memory cache (5 min TTL) — permitted by the hackathon rules — and **no Qloo response data is committed to this repository**.
- If `QLOO_API_KEY` is absent, the app runs in a permanently-labelled **demo mode** with a synthetic catalogue and synthetic affinity scores. The UI banner and the API `meta.mode` both say so.

### Request → result, redacted

For a brief of `Arijit Singh`, `Diljit Dosanjh`, `Interstellar`:

1. `GET /search?query=Arijit%20Singh&types=urn:entity:artist` → the best name match is kept only above a 0.48 similarity floor, with Qloo popularity breaking ties across entity types; the Qloo entity ID is used, never the free-text name.
2. `GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<artist_id>&take=12` → up to 12 affinity-ranked artists. The same call is made for `urn:entity:movie` and for `urn:entity:place` with `filter.location.query=Kanpur`. Transient `429`/`5xx` responses are retried with backoff.
3. Every candidate is tagged with the seed(s) that surfaced it. A candidate is attributed to a seed only when its affinity for that seed is within 0.25 of its best score, which stops every row claiming every seed.
4. The solver picks one combination. All numbers shown in the trace (call count, cache hits, solver time, candidate counts, affinity) are measured at runtime.

No raw Qloo payloads are committed; the screenshot and the example above are redacted. Entity IDs, names and scores in the repository are synthetic demo data.

## Run it

```bash
npm install
cp .env.example .env      # add QLOO_API_KEY=... to go live
npm run dev               # API on :8787, UI on :5173
```

Production build:

```bash
npm run build
npm start                 # serves the built UI and the API on :8787
```

### Demo mode vs live mode

| | Demo | Live |
| --- | --- | --- |
| Seeds resolved locally | ✅ | via Qloo `/search` |
| Affinity scores | synthetic, deterministic | Qloo Insights |
| Fees | synthetic planning weights | modelled from affinity (see below) |
| UI badge | `Demo data` / `SYNTHETIC` | `Live Qloo` / `LIVE` |

The data-source switch is in the left panel. Live mode is disabled until the server has a key.

## Deploy

The app is a single-page frontend plus three JSON endpoints. The API is exposed at both `/api/*` and `/functions/v1/app/*`, and routes on an `op` query parameter, so platform path rewrites cannot break it.

- **Vercel**: import the repository, keep the detected Vite build (`npm run build`, output `dist`), and set `QLOO_API_KEY` as a project environment variable. `vercel.json` sends both API prefixes to `api/index.js` with a 60-second function budget.
- **Qoder Sites**: `npm run deploy:function` builds the edge-function bundle, then publish `dist` as the web directory with `deploy/qoder/function` as the function directory. The function is Deno-native and reads the key from the site Secret `QLOO_API_KEY`.

Without a key, both deployments start in labelled demo mode. The UI's source toggle disables Live until `/functions/v1/app/health?op=health` reports `liveQloo: true`.

## How the solver works

`server/planner.js`

- Candidate pools are trimmed to the top 14 artists, 6 films and 9 vendors by affinity.
- Enumerates 3-artist combinations (respecting `maxPerTag` per primary genre), 1 film, and 3 vendors with distinct cuisines — up to ~180k combinations per run, typically in 0.5–1.5 s in Node.
- Scores each feasible lineup:

  ```
  0.50 × average affinity
  + 0.16 × headliner affinity
  + 0.14 × (0.55 × genre spread + 0.45 × cuisine spread)
  + 0.20 × budget fit (targets ~86% envelope use)
  ```

- If the budget cannot support the full shape, it degrades in a logged order: 3 acts + 2 vendors, then 2 acts + 2 vendors, then drops the film. Every degradation is surfaced as a warning.

## Honesty notes

- **Fees are modelled planning weights, not quotes.** Demo entries carry a synthetic fee. Live entries derive a fee from Qloo affinity and a deterministic jitter. The UI labels this everywhere.
- **Demo affinities are synthetic.** The demo catalogue uses real-world names so the flow is legible, but no score or provenance claim in demo mode comes from Qloo.
- **The agent is deterministic.** It is a tool-using planner (resolve → read → solve → validate → re-plan), not an LLM wrapper. Every number in the trace is measured.
- **Affinity is aggregate.** Qloo describes what audiences with similar taste tend to like. It is not a prediction about any individual student.
- **No ticketing or contracting.** FestOS does not verify artist availability, hold inventory, or issue contracts.
- **City coverage varies.** When Qloo has no place results for the requested city, the place lookup retries without the location filter and reports `placeScope: broader`. Place results are also filtered to food and drink venues before they can enter the food row.

## Stack

- Node 20+ / Express API (ESM)
- React 19 + TypeScript + Vite
- No database, no external auth, no client-side API keys

## Repository layout

```
server/
  agent.js      plan orchestration and trace
  qloo.js       Qloo client, normalisation, private cache, demo routing
  planner.js    constrained lineup search, validation, diffing
  demo.js       synthetic catalogue for demo mode
  app.js        Express routes + local static hosting
  index.js      Node listener
  index.ts      Deno edge handler used by Qoder Sites
api/
  index.js      Vercel function entry
src/
  App.tsx       brief, results, trace, re-planning UI
  styles.css    single stylesheet
scripts/
  build-function.mjs  packages the edge function
```

## License

Apache-2.0.
