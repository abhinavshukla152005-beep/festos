import test from 'node:test';
import assert from 'node:assert/strict';
import { draftSettlement, createSettlementOrders, captureSettlementOrder } from '../server/settlement.js';

const plan = {
  totals: { budgetInr: 1000000 },
  lineup: [
    { slot: 'headliner', label: 'Headliner', role: 'headliner', kind: 'artist', name: 'Headliner Act', feeInr: 300000, entity_id: 'h1' },
    { slot: 'movie', label: 'Movie', role: 'screening', kind: 'movie', name: 'Late Film', feeInr: 100000, entity_id: 'm1' },
    { slot: 'support', label: 'Support act', role: 'support', kind: 'artist', name: 'Support Act', feeInr: 200000, entity_id: 's1' },
    { slot: 'food1', label: 'Food row', role: 'food', kind: 'place', name: 'Chai Stall', feeInr: 50000, entity_id: 'f1' },
  ],
};

function jsonResponse(status, data) {
  return { ok: status < 400, status, text: async () => JSON.stringify(data) };
}

test('draft: strict priority stops at the first slot that breaks the cap', () => {
  const draft = draftSettlement({ plan, depositPct: 30, capInr: 130000 });
  const [headliner, movie, support, food] = draft.obligations;

  assert.equal(headliner.funded, true);
  assert.equal(movie.funded, true);
  assert.equal(support.decision, 'deferred');
  assert.match(support.reason, /Over the cap/);
  assert.equal(food.decision, 'deferred');
  assert.match(food.reason, /higher-priority/);
  assert.equal(draft.totals.fundedInr, 120000);
  assert.equal(draft.totals.deferredInr, 75000);
  assert.equal(draft.totals.holdbackInr, 455000);
});

test('draft: deposit percentage and USD conversion are applied per slot', () => {
  const draft = draftSettlement({ plan, depositPct: 50, capInr: 1000000 });
  const headliner = draft.obligations[0];
  assert.equal(headliner.depositInr, 150000);
  assert.equal(headliner.holdbackInr, 150000);
  assert.equal(headliner.depositUsd, Math.round((150000 / 83.5) * 100) / 100);
  assert.equal(draft.totals.fundedCount, 4);
});

test('draft: rejects an empty plan', () => {
  assert.throws(() => draftSettlement({}), /plan with at least one/);
});

test('simulator: create and capture follow the order lifecycle without credentials', async () => {
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;

  const created = await createSettlementOrders({
    origin: 'https://festos.example',
    runId: 'run-sim',
    obligations: [{ id: 'obl-headliner', payee: 'Headliner Act', amountUsd: 1234.56 }],
  });

  assert.equal(created.mode, 'simulator');
  assert.match(created.orders[0].orderId, /^SIM-[A-F0-9]{8}$/);
  assert.equal(created.orders[0].approveUrl, null);

  const captured = await captureSettlementOrder({ orderId: created.orders[0].orderId });
  assert.equal(captured.status, 'COMPLETED');
  assert.match(captured.captureId, /^SIMCAP-/);
  assert.equal(captured.mode, 'simulator');
});

test('sandbox: create sends a USD Orders v2 payload and capture reads the capture id', async () => {
  process.env.PAYPAL_CLIENT_ID = 'sandbox-client-id';
  process.env.PAYPAL_CLIENT_SECRET = 'sandbox-secret';

  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return jsonResponse(200, { access_token: 'TOKEN', expires_in: 3600 });
    }
    if (target.endsWith('/v2/checkout/orders')) {
      return jsonResponse(201, {
        id: 'ORDER-1',
        status: 'CREATED',
        links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/checkoutnow?token=ORDER-1' }],
      });
    }
    if (target.endsWith('/v2/checkout/orders/ORDER-1/capture')) {
      return jsonResponse(201, {
        id: 'ORDER-1',
        status: 'COMPLETED',
        payer: { name: { given_name: 'Test', surname: 'Buyer' } },
        purchase_units: [
          {
            payments: {
              captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '12.34' } }],
            },
          },
        ],
      });
    }
    return jsonResponse(404, { message: 'unexpected request' });
  };

  const created = await createSettlementOrders({
    origin: 'https://festos.example',
    runId: 'run-live',
    obligations: [{ id: 'obl-headliner', payee: 'Headliner Act', amountUsd: 12.34 }],
  });

  assert.equal(created.mode, 'sandbox');
  assert.equal(created.orders[0].approveUrl, 'https://sandbox.paypal.com/checkoutnow?token=ORDER-1');

  const createRequest = requests.find((r) => r.url.endsWith('/v2/checkout/orders'));
  const body = JSON.parse(createRequest.init.body);
  assert.equal(body.intent, 'CAPTURE');
  assert.equal(body.purchase_units[0].amount.currency_code, 'USD');
  assert.equal(body.purchase_units[0].amount.value, '12.34');
  assert.match(body.application_context.return_url, /settlement=return&obligation=obl-headliner/);
  assert.ok(createRequest.init.headers['PayPal-Request-Id']);

  const captured = await captureSettlementOrder({ orderId: 'ORDER-1' });
  assert.equal(captured.captureId, 'CAP-1');
  assert.equal(captured.payerName, 'Test Buyer');
  assert.equal(captured.amountUsd, 12.34);
});

test('orders: rejects out-of-range amounts and unsafe ids', async () => {
  await assert.rejects(
    createSettlementOrders({
      origin: 'https://festos.example',
      obligations: [{ id: 'obl-headliner', payee: 'X', amountUsd: 0 }],
    }),
    /between \$0.01/,
  );
  await assert.rejects(
    createSettlementOrders({
      origin: 'https://festos.example',
      obligations: [{ id: '../etc', payee: 'X', amountUsd: 10 }],
    }),
    /Invalid obligation id/,
  );
});
