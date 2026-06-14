// channel/index.js — "Pigeonpost", the stubbed channel service (port 4100).
//
// This deliberately mimics how real providers (WhatsApp BSPs, SMS gateways,
// ESPs) behave, because the assignment's core systems question lives here:
//
//   • send is acknowledged with 202 long before anything "happens"
//   • outcomes arrive later as webhooks (receipts), in BURSTS and OUT OF ORDER
//   • webhooks are retried with exponential backoff until the consumer acks,
//     which means the consumer WILL see duplicates → it must be idempotent
//
// Simulated funnel per message:
//   DELIVERED ~92% | FAILED ~8%
//   of delivered: OPENED ~55% → of opened: CLICKED ~28% → of clicked: CONVERTED ~30%
//
// Nothing is persisted here — a channel provider is someone else's system;
// the CRM must own its own state.

try {
  process.loadEnvFile();
} catch (e) {
  console.warn('loadEnvFile warning:', e.message);
}

import express from 'express';
import { randomUUID } from 'node:crypto';

const PORT = process.env.CHANNEL_PORT || 4100;
const app = express();
app.use(express.json({ limit: '5mb' }));

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const FAIL_REASONS = ['number unreachable', 'recipient opted out at carrier', 'handset offline > 24h', 'invalid recipient address'];

// -------------------------------------------------- outcome simulation

function simulate(msg) {
  // Returns the lifecycle events this message will produce, each with a delay.
  const events = [];
  const e = (type, delay, extra = {}) => events.push({
    event_id: randomUUID(),
    communication_id: msg.communication_id,
    type,
    at: new Date(Date.now() + delay).toISOString(),
    delay,
    ...extra,
  });

  if (Math.random() < 0.08) {
    e('FAILED', rnd(800, 6000), { reason: FAIL_REASONS[Math.floor(Math.random() * FAIL_REASONS.length)] });
    return events;
  }
  const dAt = rnd(500, 8000);
  e('DELIVERED', dAt);
  if (Math.random() < 0.55) {
    const oAt = dAt + rnd(2000, 20000);
    e('OPENED', oAt);
    if (Math.random() < 0.28) {
      const cAt = oAt + rnd(1500, 12000);
      e('CLICKED', cAt);
      if (Math.random() < 0.30) {
        e('CONVERTED', cAt + rnd(3000, 15000), { amount: Math.round(rnd(35, 120)) * 10 });
      }
    }
  }
  return events;
}

// -------------------------------------------------- receipt delivery (webhooks)

// Receipts are buffered per callback URL and flushed in bursts — like a real
// provider's webhook batcher. Order within a burst is shuffled on purpose.
const outbox = new Map(); // callback_url -> [events]
let stats = { accepted: 0, callbacks_sent: 0, callback_failures: 0 };

function scheduleEvents(callbackUrl, events) {
  for (const ev of events) {
    setTimeout(() => {
      if (!outbox.has(callbackUrl)) outbox.set(callbackUrl, []);
      outbox.get(callbackUrl).push(ev);
    }, ev.delay);
  }
}

setInterval(() => {
  for (const [url, events] of outbox) {
    if (events.length === 0) continue;
    const batch = events.splice(0, events.length);
    batch.sort(() => Math.random() - 0.5); // out-of-order, deliberately
    postWithRetry(url, { events: batch });
  }
}, 1200);

async function postWithRetry(url, payload, attempt = 1) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status >= 500) throw new Error(`consumer responded ${res.status}`);
    stats.callbacks_sent += payload.events.length;
  } catch (err) {
    stats.callback_failures++;
    if (attempt >= 5) {
      console.error(`[pigeonpost] dropping ${payload.events.length} receipts after 5 attempts: ${err.message}`);
      return;
    }
    const backoff = Math.min(30000, 500 * 2 ** attempt) + rnd(0, 300); // expo + jitter
    setTimeout(() => postWithRetry(url, payload, attempt + 1), backoff);
  }
}

// -------------------------------------------------- send APIs

app.post('/v1/send/batch', (req, res) => {
  const { callback_url, messages } = req.body || {};
  if (!callback_url || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'callback_url and messages[] are required' });
  if (messages.length > 200)
    return res.status(429).json({ error: 'batch too large (max 200)' });

  for (const m of messages) {
    if (!m.communication_id || !m.recipient || !m.channel)
      return res.status(400).json({ error: 'each message needs communication_id, recipient, channel' });
  }
  for (const m of messages) scheduleEvents(callback_url, simulate(m));
  stats.accepted += messages.length;
  res.status(202).json({ accepted: messages.length });
});

app.post('/v1/send', (req, res) => {
  const m = req.body || {};
  if (!m.callback_url || !m.communication_id || !m.recipient || !m.channel)
    return res.status(400).json({ error: 'callback_url, communication_id, recipient, channel are required' });
  scheduleEvents(m.callback_url, simulate(m));
  stats.accepted += 1;
  res.status(202).json({ accepted: 1 });
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'pigeonpost-channel', stats }));

app.listen(PORT, () => console.log(`[pigeonpost] channel service on :${PORT}`));
