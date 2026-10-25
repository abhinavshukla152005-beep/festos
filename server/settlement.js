// Settlement engine: turns a planned lineup into auditable vendor deposits.
//
// The policy is deterministic and boring on purpose: critical slots are funded
// first, flexible food vendors are funded last, and nothing is paid above the
// committee's cap. Every decision carries a reason the UI can show.

import { randomUUID } from 'node:crypto';
import { createOrder, captureOrder, paypalStatus } from './paypal.js';

const FX_INR_PER_USD = 83.5;

const ROLE_POLICY = {
  headliner: {
    tier: 'critical',
    priority: 1,
    dueDays: 3,
    rationale: 'Locks the date. Without this deposit the poster and ticket launch cannot go out.',
  },
  screening: {
    tier: 'critical',
    priority: 2,
    dueDays: 5,
    rationale: 'Holds the screening venue before the run of show is published.',
  },
  support: {
    tier: 'core',
    priority: 3,
    dueDays: 7,
    rationale: 'Secures the middle of the night; replaceable, but only if this deposit clears.',
  },
  opener: {
    tier: 'core',
    priority: 4,
    dueDays: 9,
    rationale: 'Smallest artist commitment, so it is paid after the core slots are secure.',
  },
  food: {
    tier: 'flexible',
    priority: 5,
    dueDays: 12,
    rationale: 'Food vendors can be paid on delivery, so they are funded last.',
  },
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function formatInr(amount) {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function formatUsd(amount) {
  return `$${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toUsd(inr, fx) {
  return Math.max(0.01, Math.round((inr / fx) * 100) / 100);
}

function planKeyOf(lineup) {
  const text = lineup
    .map((pick) => `${pick.slot}:${pick.entity_id}:${pick.feeInr}`)
    .join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

export function draftSettlement(input = {}) {
  const plan = input.plan;
  if (!plan || !Array.isArray(plan.lineup) || plan.lineup.length === 0) {
    throw Object.assign(new Error('A plan with at least one booked slot is required.'), {
      statusCode: 400,
    });
  }
  if (plan.lineup.length > 12) {
    throw Object.assign(new Error('A settlement run supports at most 12 slots.'), {
      statusCode: 400,
    });
  }

  const depositPct = Math.round(clamp(input.depositPct, 10, 100, 30));
  const fxInrPerUsd = clamp(input.fxInrPerUsd, 50, 150, FX_INR_PER_USD);
  const planBudgetInr = Math.max(
    0,
    Number(plan.totals?.budgetInr) || plan.lineup.reduce((sum, p) => sum + (Number(p.feeInr) || 0), 0),
  );
  const capInr = clamp(input.capInr, 0, 1000000000, planBudgetInr);

  const obligations = plan.lineup
    .map((pick, index) => {
      const policy = ROLE_POLICY[pick.role] || ROLE_POLICY.support;
      const feeInr = Math.max(0, Math.round(Number(pick.feeInr) || 0));
      const depositInr = Math.round((feeInr * depositPct) / 100);
      return {
        id: `obl-${safeId(pick.slot || pick.role || `slot-${index}`)}`,
        slot: pick.slot || `slot-${index}`,
        label: pick.label || pick.role || `Slot ${index + 1}`,
        role: pick.role || 'support',
        kind: pick.kind,
        payee: pick.name,
        stage: pick.stage || null,
        feeInr,
        feeUsd: toUsd(feeInr, fxInrPerUsd),
        depositInr,
        depositUsd: toUsd(depositInr, fxInrPerUsd),
        holdbackInr: feeInr - depositInr,
        tier: policy.tier,
        priority: policy.priority,
        dueInDays: policy.dueDays,
        rationale: policy.rationale,
        funded: false,
        decision: 'deferred',
        reason: null,
        _index: index,
      };
    })
    .sort((a, b) => a.priority - b.priority || b.depositInr - a.depositInr || a._index - b._index)
    .map(({ _index, ...rest }) => rest);

  let runningInr = 0;
  let blocked = false;
  for (const obligation of obligations) {
    if (obligation.depositInr <= 0) {
      obligation.decision = 'none';
      obligation.reason = 'No deposit is due on this slot.';
      continue;
    }
    if (blocked) {
      obligation.decision = 'deferred';
      obligation.reason = 'Held back behind an unfunded higher-priority slot.';
      continue;
    }
    if (runningInr + obligation.depositInr <= capInr) {
      runningInr += obligation.depositInr;
      obligation.funded = true;
      obligation.decision = 'funded';
      obligation.reason = null;
    } else {
      blocked = true;
      const shortfall = obligation.depositInr - Math.max(0, capInr - runningInr);
      obligation.reason = `Over the cap by ${formatInr(shortfall)} at ${depositPct}% deposit.`;
    }
  }

  const payable = obligations.filter((o) => o.depositInr > 0);
  const funded = obligations.filter((o) => o.funded);
  const deferred = obligations.filter((o) => o.decision === 'deferred');
  const feeInr = obligations.reduce((sum, o) => sum + o.feeInr, 0);
  const depositInr = payable.reduce((sum, o) => sum + o.depositInr, 0);
  const fundedInr = funded.reduce((sum, o) => sum + o.depositInr, 0);
  const fundedUsd =
    Math.round(funded.reduce((sum, o) => sum + o.depositUsd, 0) * 100) / 100;
  const deferredInr = depositInr - fundedInr;
  const holdbackInr = feeInr - depositInr;

  const headliner = obligations.find((o) => o.role === 'headliner');
  const headlineLine =
    headliner && headliner.funded
      ? `${headliner.payee}'s deposit is first in the queue.`
      : headliner
        ? `${headliner.payee}'s deposit did not clear the cap, so nothing below it was funded.`
        : 'No headliner is booked on this run.';

  const brief = [
    `FestOS is funding ${funded.length} of ${payable.length} deposits — ${formatUsd(fundedUsd)} — inside a ${formatInr(capInr)} cap.`,
    headlineLine,
    deferred.length
      ? `${deferred.length} slot${deferred.length === 1 ? '' : 's'} stayed deferred rather than breaking the cap.`
      : 'Every booked slot is covered at this deposit level.',
    `${formatInr(holdbackInr)} of holdback stays in the committee's account until delivery.`,
  ].join(' ');

  const warnings = [];
  if (deferredInr > 0) {
    warnings.push(
      `${formatInr(deferredInr)} of deposits are unfunded. Raise the cap or lower the deposit percentage.`,
    );
  }
  warnings.push(
    `PayPal cannot settle INR. Deposits are charged in USD at a fixed demo rate of ₹${fxInrPerUsd.toFixed(2)} = $1.00.`,
  );

  return {
    planKey: planKeyOf(plan.lineup),
    runId: randomUUID(),
    policy: {
      depositPct,
      capInr,
      planBudgetInr,
      fxInrPerUsd,
      currency: 'USD',
      rule: 'Strict priority: headliner → venue → support → opener → food. Nothing below a deferral is funded.',
    },
    obligations,
    totals: {
      feeInr,
      depositInr,
      fundedInr,
      fundedUsd,
      deferredInr,
      holdbackInr,
      capInr,
      headroomInr: capInr - fundedInr,
      slots: obligations.length,
      fundedCount: funded.length,
      payableCount: payable.length,
    },
    brief,
    warnings,
  };
}

function cleanAmounts(obligations) {
  if (!Array.isArray(obligations) || obligations.length === 0) {
    throw Object.assign(new Error('At least one settlement obligation is required.'), {
      statusCode: 400,
    });
  }
  if (obligations.length > 8) {
    throw Object.assign(new Error('A PayPal run supports at most 8 orders at a time.'), {
      statusCode: 400,
    });
  }
  return obligations.map((o) => {
    const id = String(o.id || '');
    if (!/^[a-z0-9-]{3,40}$/.test(id)) {
      throw Object.assign(new Error(`Invalid obligation id: ${id.slice(0, 40)}`), {
        statusCode: 400,
      });
    }
    const amountUsd = Math.round(Number(o.amountUsd) * 100) / 100;
    if (!Number.isFinite(amountUsd) || amountUsd < 0.01 || amountUsd > 25000) {
      throw Object.assign(
        new Error(`Order for ${id} must be between $0.01 and $25,000.00 USD.`),
        { statusCode: 400 },
      );
    }
    return {
      id,
      payee: String(o.payee || 'Vendor').slice(0, 80),
      amountUsd,
      description: String(o.description || `${o.payee || 'Vendor'} booking deposit`).slice(0, 127),
    };
  });
}

function requestKey(runId, id, amountUsd) {
  const raw = `festos-${runId}-${id}-${amountUsd.toFixed(2)}`.replace(/[^A-Za-z0-9_-]/g, '');
  return raw.slice(0, 100);
}

export async function createSettlementOrders({ obligations, origin, runId }) {
  const cleaned = cleanAmounts(obligations);
  const status = paypalStatus();
  const safeOrigin = String(origin || '').replace(/\/$/, '');
  if (!/^https?:\/\/[a-z0-9.:-]+$/i.test(safeOrigin)) {
    throw Object.assign(new Error('Could not determine the public return URL for this host.'), {
      statusCode: 500,
    });
  }
  const run = String(runId || randomUUID()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);

  const results = await Promise.all(
    cleaned.map(async (obligation) => {
      const callback = `${safeOrigin}/?settlement=return&obligation=${obligation.id}`;
      if (!status.configured) {
        return {
          obligationId: obligation.id,
          payee: obligation.payee,
          orderId: `SIM-${randomUUID().slice(0, 8).toUpperCase()}`,
          status: 'CREATED',
          approveUrl: null,
          amountUsd: obligation.amountUsd,
          mode: 'simulator',
          createdAt: new Date().toISOString(),
        };
      }
      try {
        const order = await createOrder({
          amountUsd: obligation.amountUsd,
          referenceId: obligation.id,
          description: obligation.description,
          returnUrl: callback,
          cancelUrl: `${safeOrigin}/?settlement=cancel&obligation=${obligation.id}`,
          requestId: requestKey(run, obligation.id, obligation.amountUsd),
        });
        return {
          obligationId: obligation.id,
          payee: obligation.payee,
          ...order,
          createdAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          obligationId: obligation.id,
          payee: obligation.payee,
          mode: 'sandbox',
          error: err.message,
          issue: err.issue || null,
        };
      }
    }),
  );

  return {
    mode: status.mode,
    orders: results.filter((row) => !row.error),
    errors: results.filter((row) => row.error),
  };
}

export async function captureSettlementOrder({ orderId }) {
  const id = String(orderId || '').trim();
  if (!id) {
    throw Object.assign(new Error('An order id is required.'), { statusCode: 400 });
  }

  const status = paypalStatus();
  if (!status.configured) {
    if (!/^SIM-[A-F0-9]{8}$/.test(id)) {
      throw Object.assign(
        new Error('This host is running the PayPal simulator, so only simulated orders can be approved.'),
        { statusCode: 409 },
      );
    }
    return {
      orderId: id,
      status: 'COMPLETED',
      captureId: `SIMCAP-${randomUUID().slice(0, 8).toUpperCase()}`,
      captureStatus: 'COMPLETED',
      amountUsd: null,
      currency: 'USD',
      payerName: 'Sandbox approver',
      mode: 'simulator',
      capturedAt: new Date().toISOString(),
    };
  }

  const captured = await captureOrder(id, `capture-${id}`);
  return { ...captured, capturedAt: new Date().toISOString() };
}
