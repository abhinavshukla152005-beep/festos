// PayPal Orders v2 client.
//
// Sandbox only, by design: this demo must never move real money. There is no
// live base URL in this module, and PAYPAL_ENV is deliberately ignored.

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const TOKEN_SAFETY_MS = 60_000;

let tokenCache = null;

export function paypalStatus() {
  const configured = Boolean(
    process.env.PAYPAL_CLIENT_ID?.trim() && process.env.PAYPAL_CLIENT_SECRET?.trim(),
  );
  return {
    configured,
    mode: configured ? 'sandbox' : 'simulator',
    environment: 'sandbox',
    currency: 'USD',
    note: configured
      ? 'Orders v2 sandbox calls are live. No real money can move.'
      : 'PayPal sandbox credentials are not set on this host, so the order lifecycle runs in a labelled simulator.',
  };
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

function paypalError(res, data) {
  const detail = Array.isArray(data?.details) ? data.details[0] : null;
  const err = new Error(
    detail?.description || data?.message || `PayPal responded with HTTP ${res.status}.`,
  );
  err.status = res.status;
  err.issue = detail?.issue || data?.name || null;
  return err;
}

async function accessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) return tokenCache.token;

  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !secret) throw new Error('PayPal sandbox credentials are not configured.');

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${SANDBOX_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await readJson(res);
  if (!res.ok) throw paypalError(res, data);

  tokenCache = {
    token: data.access_token,
    expiresAt: now + Math.max(120, (Number(data.expires_in) || 3600) - TOKEN_SAFETY_MS / 1000) * 1000,
  };
  return tokenCache.token;
}

export async function createOrder({ amountUsd, referenceId, description, returnUrl, cancelUrl, requestId }) {
  const token = await accessToken();
  const res = await fetch(`${SANDBOX_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: referenceId,
          description: String(description).slice(0, 127),
          amount: { currency_code: 'USD', value: amountUsd.toFixed(2) },
        },
      ],
      application_context: {
        brand_name: 'FestOS Settlement',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw paypalError(res, data);

  const approveUrl =
    (data.links || []).find((link) => link.rel === 'approve' || link.rel === 'payer-action')?.href ||
    null;

  return {
    orderId: data.id,
    status: data.status,
    approveUrl,
    amountUsd: Number(amountUsd.toFixed(2)),
    mode: 'sandbox',
  };
}

export async function captureOrder(orderId, requestId) {
  const token = await accessToken();
  const res = await fetch(
    `${SANDBOX_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      },
      body: '{}',
    },
  );
  const data = await readJson(res);
  if (!res.ok) throw paypalError(res, data);

  const unit = data.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const payerName = data.payer?.name
    ? [data.payer.name.given_name, data.payer.name.surname].filter(Boolean).join(' ')
    : null;

  return {
    orderId: data.id,
    status: data.status,
    captureId: capture?.id || null,
    captureStatus: capture?.status || null,
    amountUsd: capture?.amount ? Number(capture.amount.value) : null,
    currency: capture?.amount?.currency_code || 'USD',
    payerName: payerName || null,
    mode: 'sandbox',
  };
}
