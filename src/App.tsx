import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  Obligation,
  PayPalStatus,
  Pick,
  Plan,
  PlanResponse,
  SettlementDraft,
  SettlementOrder,
  TraceStep,
} from './types';

const API_BASE = '/functions/v1/app';
const STORE_KEY = 'festos.settlement.v1';

const inr = (amount: number) => {
  if (!Number.isFinite(amount)) return '—';
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
};

const usd = (amount: number) => {
  if (!Number.isFinite(amount)) return '—';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const signatureOf = (plan?: Plan) =>
  plan ? plan.lineup.map((p) => `${p.slot}:${p.entity_id}:${p.feeInr}`).join('|') : '';


const SAMPLE_BRIEFS = [
  { label: 'Indie + sci-fi', seeds: ['Prateek Kuhad', 'Anuv Jain', 'Interstellar'] },
  { label: 'Hip-hop + late night', seeds: ['Seedhe Maut', 'Divine', 'Tumbbad'] },
  { label: 'Punjabi + feel-good', seeds: ['Diljit Dosanjh', 'La La Land', 'Chai Sutta Bar'] },
];

function KindIcon({ kind, size = 18 }: { kind: Pick['kind']; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'movie') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
      </svg>
    );
  }
  if (kind === 'place') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z" />
        <path d="M3 10l1.6-5.2A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.8L21 10M9 20v-5h6v5" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  );
}

function StatusGlyph({ status }: { status: TraceStep['status'] }) {
  if (status === 'error') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'warn') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 3l9.5 17h-19L12 3Z" strokeLinejoin="round" />
        <path d="M12 9v4M12 16.5v.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function App() {
  const [seeds, setSeeds] = useState<string[]>(['Arijit Singh', 'Interstellar', 'Chai Sutta Bar']);
  const [draftSeed, setDraftSeed] = useState('');
  const [budgetLakh, setBudgetLakh] = useState(45);
  const [maxPerTag, setMaxPerTag] = useState(2);
  const [dataSource, setDataSource] = useState<'live' | 'demo'>('demo');
  const [liveAvailable, setLiveAvailable] = useState<boolean | null>(null);
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [paypal, setPaypal] = useState<PayPalStatus | null>(null);
  const [depositPct, setDepositPct] = useState(30);
  const [capPct, setCapPct] = useState(100);
  const [settlement, setSettlement] = useState<SettlementDraft | null>(null);
  const [settlementSignature, setSettlementSignature] = useState<string | null>(null);
  const [orders, setOrders] = useState<Record<string, SettlementOrder>>({});
  const [ledger, setLedger] = useState<SettlementOrder[]>([]);
  const [settling, setSettling] = useState(false);
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [settlementNotice, setSettlementNotice] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);
  const returnHandled = useRef(false);
  const autoRun = useMemo(() => new URLSearchParams(window.location.search).get('auto') === '1', []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health?op=health`)
      .then((r) => r.json())
      .then((h) => {
        if (cancelled) return;
        setLiveAvailable(Boolean(h.liveQloo));
        setDataSource(h.liveQloo ? 'live' : 'demo');
        setPaypal(h.paypal || null);
      })
      .catch(() => {
        if (!cancelled) setLiveAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.result?.plan) setResult(saved.result);
        if (saved.draft) setSettlement(saved.draft);
        if (saved.signature) setSettlementSignature(saved.signature);
        if (saved.orders) setOrders(saved.orders);
        if (Array.isArray(saved.ledger)) setLedger(saved.ledger);
        if (Number.isFinite(saved.depositPct)) setDepositPct(saved.depositPct);
        if (Number.isFinite(saved.capPct)) setCapPct(saved.capPct);
        if (Array.isArray(saved.seeds) && saved.seeds.length) setSeeds(saved.seeds);
        if (Number.isFinite(saved.budgetLakh)) setBudgetLakh(saved.budgetLakh);
        if (Number.isFinite(saved.maxPerTag)) setMaxPerTag(saved.maxPerTag);
      }
    } catch {
      /* local restore is a convenience, never the source of truth */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          result,
          draft: settlement,
          signature: settlementSignature,
          orders,
          ledger,
          depositPct,
          capPct,
          seeds,
          budgetLakh,
          maxPerTag,
        }),
      );
    } catch {
      /* ignore quota errors */
    }
  }, [
    restored,
    result,
    settlement,
    settlementSignature,
    orders,
    ledger,
    depositPct,
    capPct,
    seeds,
    budgetLakh,
    maxPerTag,
  ]);

  useEffect(() => {
    if (!restored || returnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const state = params.get('settlement');
    if (!state) return;
    returnHandled.current = true;
    const token = params.get('token');
    const obligationId = params.get('obligation') || undefined;
    window.history.replaceState({}, '', window.location.pathname);
    window.setTimeout(() => {
      document.getElementById('settlement')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    if (state === 'cancel') {
      setSettlementNotice('PayPal approval was cancelled. The order stays open in the ledger.');
      return;
    }
    if (token) {
      setSettlementNotice('Back from PayPal — capturing the approved deposit…');
      captureOrder(token, obligationId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  useEffect(() => {
    if (!result) {
      setVisibleSteps(0);
      return;
    }
    setVisibleSteps(0);
    const steps = result.trace?.length || 0;
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setVisibleSteps(i);
      if (i >= steps) window.clearInterval(timer);
    }, 320);
    return () => window.clearInterval(timer);
  }, [result]);

  useEffect(() => {
    if (!autoRun || liveAvailable === null || autoStarted.current) return;
    autoStarted.current = true;
    const params = new URLSearchParams(window.location.search);
    const seedList = params.get('seeds')?.split('|').map((s) => s.trim()).filter(Boolean) || seeds;
    const source = params.get('mode') === 'demo' ? 'demo' : dataSource;
    setSeeds(seedList);
    setDataSource(source);
    callPlan({
      seeds: seedList,
      budgetInr: budgetLakh * 100000,
      maxPerTag,
      location: 'Kanpur, India',
      mode: source === 'demo' ? 'demo' : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, liveAvailable]);

  const mode = result?.meta?.mode ?? dataSource;
  const plan = result?.plan;

  const summary = useMemo(() => {
    if (!result?.diff) return null;
    const kept = result.diff.changes.filter((c) => c.status === 'kept').length;
    const changed = result.diff.changes.filter((c) => c.status === 'changed').length;
    const fresh = result.diff.changes.filter((c) => c.status === 'new').length;
    return { kept, changed, fresh, dropped: result.diff.dropped.length };
  }, [result]);

  const planSignature = signatureOf(plan);
  const settlementStale = Boolean(
    settlement && settlementSignature && settlementSignature !== planSignature,
  );
  const fundedObligations = useMemo(
    () => settlement?.obligations.filter((o) => o.funded) ?? [],
    [settlement],
  );
  const orderedFunded = fundedObligations.filter((o) => orders[o.id]).length;
  const remainingFunded = fundedObligations.filter((o) => !orders[o.id]);
  const capInr = Math.round(((plan?.totals.budgetInr ?? 0) * capPct) / 100);

  async function callPlan(body: Record<string, unknown>, isReplan = false) {
    if (isReplan) setReplanning(true);
    else setLoading(true);
    setError(null);
    try {
      const op = isReplan ? 'replan' : 'plan';
      const res = await fetch(`${API_BASE}/${op}?op=${op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as PlanResponse;
      if (!res.ok) {
        setError(data.error || 'The agent could not finish this plan.');
        if (data.plan) setResult(data);
      } else {
        setResult(data);
        setLastAction(isReplan ? String(body.action || 're-plan') : null);
        if (isReplan) {
          window.setTimeout(() => {
            resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }
      }
    } catch {
      setError('Could not reach the planning API. Is the server running?');
    } finally {
      setLoading(false);
      setReplanning(false);
    }
  }

  function generate() {
    if (!seeds.length) {
      setError('Add at least one taste signal first.');
      return;
    }
    callPlan({
      seeds,
      budgetInr: budgetLakh * 100000,
      maxPerTag,
      location: 'Kanpur, India',
      mode: dataSource === 'demo' ? 'demo' : undefined,
    });
  }

  function addSeed(event?: FormEvent) {
    event?.preventDefault();
    const value = draftSeed.trim();
    if (!value) return;
    if (seeds.length >= 6) {
      setError('Six signals is the sweet spot — remove one before adding another.');
      return;
    }
    if (!seeds.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setSeeds([...seeds, value]);
    }
    setDraftSeed('');
  }

  function replan(action: 'drop' | 'budget' | 'cap') {
    if (!plan) return;
    const excludeIds: string[] = [];
    let nextBudget = plan.totals.budgetInr;
    let nextCap = maxPerTag;
    if (action === 'drop') {
      const headliner = plan.lineup.find((p) => p.role === 'headliner');
      if (headliner) excludeIds.push(headliner.entity_id);
    }
    if (action === 'budget') {
      nextBudget = Math.max(300000, Math.round(plan.totals.budgetInr * 0.75));
      setBudgetLakh(Math.round(nextBudget / 100000));
    }
    if (action === 'cap') {
      nextCap = 1;
      setMaxPerTag(1);
    }
    callPlan(
      {
        seeds,
        budgetInr: nextBudget,
        maxPerTag: nextCap,
        location: result?.meta.location || 'Kanpur, India',
        mode: dataSource === 'demo' ? 'demo' : undefined,
        excludeIds,
        previousPlan: plan,
        action:
          action === 'drop' ? 'headliner-dropout' : action === 'budget' ? 'budget-cut' : 'genre-cap',
      },
      true,
    );
  }

  async function draftSettlementRun() {
    if (!plan) return;
    setSettling(true);
    setSettlementError(null);
    setSettlementNotice(null);
    try {
      const res = await fetch(`${API_BASE}/settlement/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, depositPct, capInr }),
      });
      const data = (await res.json()) as SettlementDraft & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not draft the settlement.');
      setSettlement(data);
      setSettlementSignature(planSignature);
      setOrders({});
      window.setTimeout(() => {
        document.getElementById('settlement')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err) {
      setSettlementError(err instanceof Error ? err.message : 'Could not draft the settlement.');
    } finally {
      setSettling(false);
    }
  }

  async function fundObligations(selected: Obligation[], autoCapture = false) {
    if (!settlement || selected.length === 0) return;
    setSettling(true);
    setSettlementError(null);
    setSettlementNotice(null);
    try {
      const res = await fetch(`${API_BASE}/settlement/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: settlement.runId,
          obligations: selected.map((o) => ({
            id: o.id,
            payee: o.payee,
            amountUsd: o.depositUsd,
            description: `FestOS ${o.label}: ${o.payee} deposit (${settlement.policy.depositPct}%)`,
          })),
        }),
      });
      const data = (await res.json()) as {
        mode: string;
        orders: SettlementOrder[];
        errors?: { payee: string; error: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Could not create PayPal orders.');
      const created = data.orders || [];
      if (created.length === 0) {
        throw new Error(data.errors?.[0]?.error || 'PayPal did not return an order.');
      }
      setOrders((prev) => {
        const next = { ...prev };
        for (const order of created) next[order.obligationId] = order;
        return next;
      });
      setLedger((prev) => [
        ...prev,
        ...created.filter((order) => !prev.some((row) => row.orderId === order.orderId)),
      ]);
      if (data.errors?.length) {
        setSettlementError(data.errors.map((e) => `${e.payee}: ${e.error}`).join(' · '));
      }
      if (data.mode === 'simulator') {
        if (autoCapture) {
          for (const order of created) {
            await captureOrder(order.orderId, order.obligationId, true);
          }
          setSettlementNotice(
            `Simulated settlement complete — ${created.length} deposit${
              created.length === 1 ? '' : 's'
            } marked paid. No money moved.`,
          );
        }
      } else {
        const first = created.find((order) => order.approveUrl);
        if (first?.approveUrl) {
          setSettlementNotice(
            'Order created. Approve it in the PayPal sandbox, then you will land back here.',
          );
          window.location.assign(first.approveUrl);
        }
      }
    } catch (err) {
      setSettlementError(err instanceof Error ? err.message : 'Could not create PayPal orders.');
    } finally {
      setSettling(false);
    }
  }

  function fundOne(obligation: Obligation) {
    void fundObligations([obligation]);
  }

  function approveOrder(order: SettlementOrder) {
    if (order.approveUrl) {
      window.location.assign(order.approveUrl);
      return;
    }
    void captureOrder(order.orderId, order.obligationId);
  }

  async function captureOrder(orderId: string, obligationId?: string, silent = false) {
    setBusyOrder(orderId);
    if (!silent) setSettlementError(null);
    try {
      const res = await fetch(`${API_BASE}/settlement/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json()) as {
        error?: string;
        status?: string;
        captureId?: string | null;
        captureStatus?: string | null;
        capturedAt?: string;
        payerName?: string | null;
        amountUsd?: number | null;
        mode?: string;
      };
      if (!res.ok) throw new Error(data.error || 'PayPal could not capture this order.');
      const patch = (order: SettlementOrder): SettlementOrder => ({
        ...order,
        status: data.status || order.status,
        captureId: data.captureId ?? order.captureId,
        captureStatus: data.captureStatus ?? order.captureStatus,
        capturedAt: data.capturedAt || new Date().toISOString(),
        payerName: data.payerName ?? order.payerName,
        simulated: data.mode === 'simulator' || order.mode === 'simulator',
      });
      setOrders((prev) => {
        const key = obligationId || Object.keys(prev).find((id) => prev[id].orderId === orderId);
        if (!key || !prev[key]) return prev;
        return { ...prev, [key]: patch(prev[key]) };
      });
      setLedger((prev) => prev.map((row) => (row.orderId === orderId ? patch(row) : row)));
      if (!silent || data.mode === 'simulator') {
        setSettlementNotice(
          data.mode === 'simulator'
            ? 'Simulated capture recorded — no money moved.'
            : `PayPal captured ${data.amountUsd ? usd(data.amountUsd) : 'the deposit'}.`,
        );
      }
    } catch (err) {
      setSettlementError(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setBusyOrder(null);
    }
  }

  async function copyBrief() {
    if (!settlement || !plan) return;
    const lines = [
      '# FestOS settlement brief',
      '',
      `Plan: ${plan.headline}`,
      `Policy: ${settlement.policy.depositPct}% upfront · cap ${inr(
        settlement.policy.capInr,
      )} · ₹${settlement.policy.fxInrPerUsd.toFixed(2)} per $1`,
      '',
      settlement.brief,
      '',
      '| Slot | Payee | Deposit (USD) | Deposit (INR) | Decision | PayPal order |',
      '| --- | --- | --- | --- | --- | --- |',
      ...settlement.obligations.map(
        (o) =>
          `| ${o.label} | ${o.payee} | ${usd(o.depositUsd)} | ${inr(o.depositInr)} | ${o.decision} | ${
            orders[o.id]?.orderId || '—'
          } |`,
      ),
      '',
      `Funded: ${usd(settlement.totals.fundedUsd)} (${inr(
        settlement.totals.fundedInr,
      )}). Holdback: ${inr(settlement.totals.holdbackInr)}.`,
      settlement.policy.rule,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setSettlementNotice('Settlement brief copied to the clipboard.');
    } catch {
      setSettlementError('The browser blocked clipboard access.');
    }
  }

  return (
    <div className="app">
      <div className="grain" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="FestOS home">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
              <path d="M6 26V6h20v5H12v4h11v5H12v6H6Z" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-word">
            FEST<span>OS</span>
          </span>
        </a>
        <div className="topbar-meta">
          <span className={`mode-pill mode-pill--${mode}`} title={result?.meta.note || undefined}>
            <span className="dot" />
            {mode === 'live' ? 'Live Qloo' : 'Demo data'}
          </span>
          <a className="ghost-link" href="https://github.com/abhinavshukla152005-beep/festos" target="_blank" rel="noreferrer">
            GitHub <Arrow size={14} />
          </a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Agentic commerce · 2026</p>
            <h1>
              Your campus has taste.
              <br />
              Your lineup should too.
            </h1>
            <p className="lede">
              FestOS is a planning agent for student fests. Give it a few things your campus actually loves —
              it resolves them on the Qloo taste graph, finds culturally-aligned acts, then solves the budget,
              genre mix and vendor spread into one run of show. A second agent turns that plan into vendor
              deposits and settles them through PayPal.
            </p>
            <div className="hero-notes">
              <span>Qloo Insights API</span>
              <span>Constraint solver</span>
              <span>PayPal settlement</span>
              <span>Live re-planning</span>
            </div>
          </div>
          <div className="hero-card">
            <div className="hero-card-top">
              <span className="mono">AGENT RUN</span>
              <span className="mono">{plan ? `${result?.meta.toolCalls ?? 0} tool calls · ${result?.meta.solverMs ?? 0} ms` : 'idle'}</span>
            </div>
            <ol className="mini-trace">
              {(result ? result.trace : [{ id: 'a', title: 'Resolve taste signals', detail: 'Qloo entity search', status: 'ok' as const, chips: [], ms: 0 }, { id: 'b', title: 'Pull audience affinities', detail: 'Qloo Insights', status: 'ok' as const, chips: [], ms: 0 }, { id: 'c', title: 'Solve the constraints', detail: 'budget · genre · vendors', status: 'ok' as const, chips: [], ms: 0 }]).slice(0, 5).map((step, i) => (
                <li key={step.id} className={result && i >= visibleSteps ? 'pending' : ''}>
                  <span className={`step-dot step-dot--${step.status}`}>
                    <StatusGlyph status={step.status} />
                  </span>
                  <div>
                    <p>{step.title}</p>
                    <span>{step.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
            <div className="hero-card-foot">
              <span className={`badge badge--${mode}`}>{mode === 'live' ? 'LIVE' : 'SYNTHETIC'}</span>
              <span>{mode === 'live' ? 'affinity scores from Qloo' : 'affinity scores are simulated'}</span>
            </div>
          </div>
        </section>

        <section className="workbench">
          <aside className="brief" aria-label="Campus brief">
            <div className="panel-head">
              <h2>Campus brief</h2>
              <span className="mono">01</span>
            </div>

            <label className="field-label" htmlFor="seed-input">
              Taste signals
            </label>
            <p className="hint">Artists, films, or places students actually stream, watch and hang out at.</p>
            <form className="seed-form" onSubmit={addSeed}>
              <input
                id="seed-input"
                value={draftSeed}
                onChange={(e) => setDraftSeed(e.target.value)}
                placeholder="e.g. Prateek Kuhad"
                maxLength={40}
                autoComplete="off"
              />
              <button type="submit" aria-label="Add taste signal">
                +
              </button>
            </form>
            <div className="chips" aria-label="Selected taste signals">
              {seeds.map((seed) => (
                <button
                  key={seed}
                  type="button"
                  className="chip"
                  onClick={() => setSeeds(seeds.filter((s) => s !== seed))}
                  title="Remove"
                >
                  {seed}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>

            <div className="field-split">
              <label className="field-label" htmlFor="budget">
                Budget <span>{inr(budgetLakh * 100000)}</span>
              </label>
              <input
                id="budget"
                type="range"
                min={10}
                max={80}
                step={1}
                value={budgetLakh}
                onChange={(e) => setBudgetLakh(Number(e.target.value))}
              />
              <div className="range-ends mono">
                <span>₹10 L</span>
                <span>₹80 L</span>
              </div>
            </div>

            <div className="field-split">
              <span className="field-label">
                Diversity cap <span>per genre</span>
              </span>
              <div className="segmented" role="group" aria-label="Maximum acts per genre">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={maxPerTag === n ? 'active' : ''}
                    aria-pressed={maxPerTag === n}
                    onClick={() => setMaxPerTag(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-split">
              <span className="field-label">Data source</span>
              <div className="segmented segmented--wide" role="group" aria-label="Data source">
                <button
                  type="button"
                  disabled={liveAvailable === false}
                  className={dataSource === 'live' ? 'active' : ''}
                  onClick={() => setDataSource('live')}
                  title={liveAvailable === false ? 'Add QLOO_API_KEY to server/.env to enable live mode' : undefined}
                >
                  Live Qloo
                </button>
                <button
                  type="button"
                  className={dataSource === 'demo' ? 'active' : ''}
                  onClick={() => setDataSource('demo')}
                >
                  Demo data
                </button>
              </div>
              <p className="hint hint--small">
                {liveAvailable === false
                  ? 'API key pending — demo mode uses clearly-labelled synthetic affinities.'
                  : liveAvailable === null
                    ? 'Checking key…'
                    : 'Live mode calls Qloo server-side; the key never reaches the browser.'}
              </p>
            </div>

            <button className="primary-cta" onClick={generate} disabled={loading || seeds.length === 0}>
              {loading ? <span className="spinner" aria-hidden="true" /> : null}
              {loading ? 'Agent is working…' : plan ? 'Re-run the agent' : 'Plan my fest'}
              {!loading ? <Arrow /> : null}
            </button>

            <div className="samples">
              <span className="mono">TRY A BRIEF</span>
              <div className="sample-row">
                {SAMPLE_BRIEFS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      setSeeds(s.seeds);
                      setDraftSeed('');
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="output" ref={resultRef}>
            {!plan && !loading && (
              <div className="empty">
                <div className="empty-orbit" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <KindIcon kind="artist" size={34} />
                </div>
                <h2>One brief. One run of show.</h2>
                <p>
                  Add signals, set your budget, press <strong>Plan my fest</strong>. The agent resolves every
                  signal, evaluates hundreds of lineups, and explains each booking.
                </p>
                <div className="empty-steps">
                  <article>
                    <span className="mono">STEP 01</span>
                    <h3>Resolve</h3>
                    <p>Maps “Arijit Singh” or “Chai Sutta Bar” to Qloo entities.</p>
                  </article>
                  <article>
                    <span className="mono">STEP 02</span>
                    <h3>Read taste</h3>
                    <p>Pulls affinity-ranked artists, films and local places.</p>
                  </article>
                  <article>
                    <span className="mono">STEP 03</span>
                    <h3>Solve</h3>
                    <p>Fits budget, genre caps, vendor variety and a run of show.</p>
                  </article>
                </div>
                {error && <p className="error-banner">{error}</p>}
              </div>
            )}

            {loading && !plan && (
              <div className="loading-panel">
                <div className="pulse" aria-hidden="true" />
                <h2>Reading your campus</h2>
                <p>The agent is resolving signals and pulling affinities. This usually takes a few seconds.</p>
                <div className="skeleton-lines" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            {plan && (
              <>
                <div className="result-head">
                  <div>
                    <p className="eyebrow">
                      {mode === 'live' ? 'Qloo-backed plan' : 'Demo plan'} · generated {fmtTime(plan.generatedAt)}
                    </p>
                    <h2>{plan.headline}</h2>
                    <p className="result-sub">
                      {result?.meta.seeds.map((s) => s.query).join(' · ')}
                      {result?.meta.unresolved?.length ? ` · unresolved: ${result.meta.unresolved.join(', ')}` : ''}
                    </p>
                  </div>
                  <div className="headline-actions">
                    <a className="sim sim--pay" href="#settlement">
                      <span aria-hidden="true">$</span> PayPal settlement
                    </a>
                    <button className="sim" onClick={() => replan('drop')} disabled={replanning}>
                      <KindIcon kind="artist" size={15} /> Headliner drops out
                    </button>
                    <button className="sim" onClick={() => replan('budget')} disabled={replanning}>
                      <span aria-hidden="true">₹</span> Cut budget 25%
                    </button>
                    <button className="sim" onClick={() => replan('cap')} disabled={replanning}>
                      Tighten genre cap
                    </button>
                  </div>
                </div>

                {mode === 'demo' && (
                  <div className="notice notice--demo">
                    <strong>Demo mode.</strong> Names are real, but affinity scores, provenance and fees are
                    synthetic. Add a Qloo hackathon key to switch the same UI to live insights.
                  </div>
                )}
                {result?.meta.note && mode === 'live' && <div className="notice">{result.meta.note}</div>}
                {plan.warnings.length > 0 && (
                  <div className="notice notice--warn">
                    {plan.warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                )}

                {summary && (
                  <div className="diff-banner">
                    <div className="diff-copy">
                      <strong>Re-planned{lastAction ? ` after ${lastAction.replace('-', ' ')}` : ''}.</strong>{' '}
                      {summary.kept} kept · {summary.changed} switched · {summary.fresh} new · {summary.dropped} dropped
                    </div>
                    <div className="diff-chips">
                      {result?.diff?.changes
                        .filter((c) => c.status !== 'kept')
                        .slice(0, 4)
                        .map((c) => (
                          <span key={c.slot} className={`diff-chip diff-chip--${c.status}`}>
                            {c.status === 'changed' ? `${c.previous} → ${c.name}` : c.name}
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                <div className="stat-strip">
                  <div>
                    <span className="mono">COMMITTED</span>
                    <strong>{inr(plan.totals.feeInr)}</strong>
                    <small>{Math.round(plan.totals.spendRatio * 100)}% of {inr(plan.totals.budgetInr)}</small>
                  </div>
                  <div>
                    <span className="mono">AVG AFFINITY</span>
                    <strong>{plan.totals.avgAffinity.toFixed(2)}</strong>
                    <small>{mode === 'live' ? 'from Qloo Insights' : 'synthetic demo score'}</small>
                  </div>
                  <div>
                    <span className="mono">GENRE SPREAD</span>
                    <strong>{plan.totals.artistTags.length}</strong>
                    <small>{plan.totals.artistTags.join(' · ')}</small>
                  </div>
                  <div>
                    <span className="mono">{mode === 'live' ? 'QLOO CALLS' : 'DEMO TOOL CALLS'}</span>
                    <strong>{result?.meta.toolCalls ?? 0}</strong>
                    <small>
                      {mode === 'live'
                        ? `${result?.meta.calls ?? 0} network · ${result?.meta.cacheHits ?? 0} cache hits`
                        : 'local only · no network'}
                    </small>
                  </div>
                </div>

                <div className="lineup" aria-label="Run of show">
                  {plan.lineup.map((pick, i) => (
                    <article
                      key={`${pick.slot}-${pick.entity_id}`}
                      className={`pick pick--${pick.kind} ${pick.role === 'headliner' ? 'pick--headliner' : ''} ${
                        pick.role === 'food' ? 'pick--compact' : ''
                      }`}
                      style={{ animationDelay: `${i * 70}ms` }}
                    >
                      <div className="pick-top">
                        <span className="pick-time mono">{pick.time}</span>
                        <span className="pick-kind">
                          <KindIcon kind={pick.kind} size={14} /> {pick.kind}
                        </span>
                      </div>
                      <div className="pick-main">
                        <div className="pick-title">
                          <span className="pick-role">{pick.label}</span>
                          <h3>{pick.name}</h3>
                        </div>
                        <span className="pick-fee">{inr(pick.feeInr)}</span>
                      </div>
                      <p className="pick-stage">{pick.stage}</p>
                      <div className="pick-tags">
                        {pick.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                      <div className="affinity">
                        <div className="affinity-bar">
                          <span style={{ width: `${Math.round(pick.score * 100)}%` }} />
                        </div>
                        <span className="mono">
                          {pick.affinity != null ? `affinity ${pick.score.toFixed(2)}` : `qloo rank #${(pick.rank ?? 0) + 1}`}
                        </span>
                      </div>
                      <p className="pick-why">{pick.why}</p>
                    </article>
                  ))}
                </div>

                <section className="checks-panel">
                  <div className="panel-head">
                    <h2>Constraint checks</h2>
                    <span className="mono">02</span>
                  </div>
                  <div className="checks">
                    {plan.checks?.map((check) => (
                      <div key={check.id} className={`check ${check.pass ? 'check--pass' : 'check--fail'}`}>
                        <span className="check-icon">
                          <StatusGlyph status={check.pass ? 'ok' : 'warn'} />
                        </span>
                        <div>
                          <strong>{check.label}</strong>
                          <p>{check.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <details className="trace">
                    <summary>
                      <span>Agent trace</span>
                      <span className="mono">
                        {result?.trace.length ?? 0} steps · {result?.meta.solverMs ?? 0} ms solver
                      </span>
                    </summary>
                    <ol>
                      {result?.trace.map((step, i) => (
                        <li key={step.id} className={i < visibleSteps ? 'shown' : ''}>
                          <span className={`step-dot step-dot--${step.status}`}>
                            <StatusGlyph status={step.status} />
                          </span>
                          <div>
                            <div className="trace-title">
                              <strong>{step.title}</strong>
                              <span className="mono">{step.ms} ms</span>
                            </div>
                            <p>{step.detail}</p>
                            {step.chips.length > 0 && (
                              <div className="trace-chips">
                                {step.chips.slice(0, 5).map((chip) => (
                                  <span key={chip}>{chip}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </details>
                </section>

                <section className="settle" id="settlement" aria-label="PayPal settlement">
                  <div className="panel-head">
                    <h2>Settlement</h2>
                    <span className="mono">03</span>
                  </div>

                  <div className="settle-grid">
                    <div className="settle-copy">
                      <p className="eyebrow">AGENTIC COMMERCE · PAYPAL SANDBOX</p>
                      <h3>The lineup is planned. Now lock the dates.</h3>
                      <p>
                        FestOS turns {plan.lineup.length} booked slots into vendor deposits, funds the
                        critical path first, and keeps an auditable PayPal ledger. The holdback stays with
                        the committee until delivery.
                      </p>
                      <div className={`settle-mode settle-mode--${paypal?.mode || 'checking'}`}>
                        <span className={`badge badge--${paypal?.mode === 'sandbox' ? 'live' : 'demo'}`}>
                          {paypal
                            ? paypal.mode === 'sandbox'
                              ? 'PAYPAL SANDBOX'
                              : 'SIMULATOR'
                            : 'CHECKING PAYPAL'}
                        </span>
                        <span>{paypal?.note || 'Checking PayPal configuration…'}</span>
                      </div>
                    </div>

                    <div className="settle-controls">
                      <span className="field-label">
                        Deposit <span>{depositPct}%</span>
                      </span>
                      <div className="segmented" role="group" aria-label="Deposit percentage">
                        {[20, 30, 50].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            className={depositPct === pct ? 'active' : ''}
                            aria-pressed={depositPct === pct}
                            onClick={() => setDepositPct(pct)}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                      <p className="hint hint--small">
                        {100 - depositPct}% holdback releases on delivery.
                      </p>

                      <div className="settle-cap">
                        <label className="field-label" htmlFor="settle-cap">
                          Deposit cap <span>{inr(capInr)}</span>
                        </label>
                        <input
                          id="settle-cap"
                          type="range"
                          min={5}
                          max={100}
                          step={5}
                          value={capPct}
                          onChange={(e) => setCapPct(Number(e.target.value))}
                        />
                        <div className="range-ends mono">
                          <span>5%</span>
                          <span>{capPct}% of budget</span>
                        </div>
                      </div>

                      {settlement ? (
                        <>
                          {remainingFunded.length > 0 ? (
                            <button
                              className="primary-cta"
                              onClick={() => fundObligations(remainingFunded, true)}
                              disabled={settling || settlementStale}
                            >
                              {settling ? <span className="spinner" aria-hidden="true" /> : null}
                              {paypal?.mode === 'sandbox'
                                ? `Create ${remainingFunded.length} PayPal order${
                                    remainingFunded.length === 1 ? '' : 's'
                                  }`
                                : `Settle ${remainingFunded.length} funded slot${
                                    remainingFunded.length === 1 ? '' : 's'
                                  }`}
                              {!settling ? <Arrow /> : null}
                            </button>
                          ) : fundedObligations.length > 0 ? (
                            <div className="settle-complete">
                              <StatusGlyph status="ok" />
                              <div>
                                <strong>Settlement complete</strong>
                                <span>
                                  {orderedFunded} of {fundedObligations.length} funded slots have
                                  PayPal orders.
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="settle-complete settle-complete--empty">
                              <StatusGlyph status="warn" />
                              <div>
                                <strong>Nothing fits this cap</strong>
                                <span>Raise the deposit cap or lower the deposit percentage.</span>
                              </div>
                            </div>
                          )}
                          <button
                            className="ghost-btn ghost-btn--wide"
                            onClick={draftSettlementRun}
                            disabled={settling}
                          >
                            Re-draft with {depositPct}% deposit
                          </button>
                        </>
                      ) : (
                        <button
                          className="primary-cta"
                          onClick={draftSettlementRun}
                          disabled={settling}
                        >
                          {settling ? <span className="spinner" aria-hidden="true" /> : null}
                          Draft settlement
                          {!settling ? <Arrow /> : null}
                        </button>
                      )}
                    </div>
                  </div>

                  {settlementStale && (
                    <div className="notice notice--warn">
                      The lineup changed since this settlement was drafted. Re-draft it before creating
                      more orders.
                    </div>
                  )}
                  {settlementError && <p className="error-banner">{settlementError}</p>}
                  {settlementNotice && <div className="notice">{settlementNotice}</div>}

                  {settlement && (
                    <>
                      <div className="settle-totals">
                        <div>
                          <span className="mono">DEPOSITS</span>
                          <strong>{usd(settlement.totals.fundedUsd)}</strong>
                          <small>
                            {inr(settlement.totals.fundedInr)} · {settlement.totals.fundedCount}/
                            {settlement.totals.payableCount} slots
                          </small>
                        </div>
                        <div>
                          <span className="mono">HOLDBACK</span>
                          <strong>{inr(settlement.totals.holdbackInr)}</strong>
                          <small>{100 - settlement.policy.depositPct}% on delivery</small>
                        </div>
                        <div>
                          <span className="mono">CAP LEFT</span>
                          <strong>{inr(settlement.totals.headroomInr)}</strong>
                          <small>of {inr(settlement.policy.capInr)}</small>
                        </div>
                        <div>
                          <span className="mono">FX</span>
                          <strong>₹{settlement.policy.fxInrPerUsd.toFixed(2)}</strong>
                          <small>per $1 · fixed demo rate</small>
                        </div>
                      </div>

                      <p className="settle-brief">{settlement.brief}</p>
                      <p className="settle-rule mono">{settlement.policy.rule}</p>

                      <div className="obligations">
                        {settlement.obligations.map((o) => {
                          const order = orders[o.id];
                          const captured = Boolean(order?.captureId);
                          return (
                            <article key={o.id} className={`obligation obligation--${o.decision}`}>
                              <div className="obl-main">
                                <div className="obl-title">
                                  <span className={`tier tier--${o.tier}`}>{o.tier}</span>
                                  <strong>{o.label}</strong>
                                  <span className="obl-payee">{o.payee}</span>
                                </div>
                                <div className="obl-money">
                                  <strong>{usd(o.depositUsd)}</strong>
                                  <span>
                                    {inr(o.depositInr)} · holdback {inr(o.holdbackInr)}
                                  </span>
                                </div>
                                <div className="obl-due mono">T-{o.dueInDays}d</div>
                                <div className="obl-status">
                                  {captured ? (
                                    <span className="pill pill--ok">
                                      {order?.simulated ? 'SIMULATED' : 'CAPTURED'}
                                    </span>
                                  ) : order ? (
                                    <span className="pill pill--wait">ORDER CREATED</span>
                                  ) : o.decision === 'funded' ? (
                                    <span className="pill pill--ready">READY</span>
                                  ) : o.decision === 'deferred' ? (
                                    <span className="pill pill--defer">DEFERRED</span>
                                  ) : (
                                    <span className="pill">NO DEPOSIT</span>
                                  )}
                                </div>
                                <div className="obl-action">
                                  {captured ? (
                                    <span className="mono obl-capture">
                                      {order?.captureId?.slice(0, 14)}…
                                    </span>
                                  ) : order ? (
                                    <button
                                      className="pay-btn"
                                      onClick={() => approveOrder(order)}
                                      disabled={busyOrder === order.orderId}
                                    >
                                      {busyOrder === order.orderId
                                        ? 'Capturing…'
                                        : order.approveUrl
                                          ? 'Approve on PayPal'
                                          : 'Approve in simulator'}
                                      <Arrow size={13} />
                                    </button>
                                  ) : o.decision === 'funded' ? (
                                    <button
                                      className="pay-btn"
                                      onClick={() => fundOne(o)}
                                      disabled={settling || settlementStale}
                                    >
                                      Fund deposit
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <p className="obl-why">{o.funded ? o.rationale : o.reason}</p>
                            </article>
                          );
                        })}
                      </div>

                      <div className="settle-actions">
                        {remainingFunded.length > 0 && !settlementStale && (
                          <button
                            className="ghost-btn"
                            onClick={() => fundObligations(remainingFunded, true)}
                            disabled={settling}
                          >
                            Settle {remainingFunded.length} remaining
                          </button>
                        )}
                        <button className="ghost-btn" onClick={copyBrief}>
                          Copy settlement brief
                        </button>
                        <span className="hint hint--small">
                          {orderedFunded} of {fundedObligations.length} funded slots have PayPal orders.
                        </span>
                      </div>

                      {ledger.length > 0 && (
                        <details className="ledger" open>
                          <summary>
                            <span>PayPal ledger</span>
                            <span className="mono">{ledger.length} orders</span>
                          </summary>
                          <div className="ledger-table">
                            {ledger.map((o) => (
                              <div key={o.orderId} className="ledger-row">
                                <span className="mono">{o.mode.toUpperCase()}</span>
                                <span className="ledger-id">{o.orderId}</span>
                                <span>{o.payee}</span>
                                <span>{usd(o.amountUsd)}</span>
                                <span
                                  className={`pill ${o.captureId ? 'pill--ok' : 'pill--wait'}`}
                                  title={o.captureId ? `Capture ${o.captureId}` : undefined}
                                >
                                  {o.captureId
                                    ? o.simulated
                                      ? 'SIMULATED'
                                      : 'CAPTURED'
                                    : o.status}
                                </span>
                                <span className="mono">
                                  {fmtTime(o.capturedAt || o.createdAt)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}

                      <p className="footnote">
                        Sandbox only — no live-money code path. PayPal cannot settle INR, so deposits are
                        converted at a fixed demo rate; the USD amount is what PayPal would charge.
                        {paypal?.mode === 'simulator'
                          ? ' No PayPal credentials on this host, so the order lifecycle is simulated locally and labelled as such.'
                          : ''}
                      </p>
                    </>
                  )}
                </section>

                {error && <p className="error-banner">{error}</p>}
                {replanning && (
                  <div className="replan-overlay" role="status">
                    <span className="spinner" /> Re-planning with the new constraint…
                  </div>
                )}

                <p className="footnote">
                  Fees are modelled planning weights, not quotes. {mode === 'live' ? 'Affinity comes from Qloo;' : 'Affinity and fees are synthetic demo values;'}{' '}
                  the budget envelope and diversity caps are applied by a deterministic solver, and every run is
                  reproducible. Qloo responses are cached privately server-side and never committed.
                </p>
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <div>
          <span className="brand-word brand-word--small">
            FEST<span>OS</span>
          </span>
          <p>Built for the Qloo Agentic Hackathon 2026 and the PayPal AI Hackathon. Not affiliated with Qloo or PayPal.</p>
        </div>
        <div className="foot-links">
          <a href="https://github.com/abhinavshukla152005-beep/festos" target="_blank" rel="noreferrer">
            Source
          </a>
          <a href="https://paypalaihackathon.devpost.com/" target="_blank" rel="noreferrer">
            PayPal hackathon
          </a>
          <a href="https://qloo.devpost.com/" target="_blank" rel="noreferrer">
            Qloo hackathon
          </a>
          <a href="https://docs.qloo.com" target="_blank" rel="noreferrer">
            Qloo docs
          </a>
        </div>
      </footer>
    </div>
  );
}
