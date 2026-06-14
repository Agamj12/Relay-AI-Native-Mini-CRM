// ai.js — the AI layer. Three capabilities, each LLM-backed with a deterministic
// fallback so the product works end-to-end even without an API key:
//
//   1. nlToSegment   — natural language → validated rule AST (never raw SQL)
//   2. draftMessages — objective + audience → 3 on-brand message variants
//   3. campaignInsight — funnel stats → a marketer-readable narrative
//
// Design choice: the LLM only ever produces *structured intent* (rule ASTs,
// template strings with whitelisted tokens). Execution stays in deterministic
// code. That keeps the AI useful without ever letting it touch data directly.

import { validateRules } from './segmentEngine.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export const aiEnabled = () => Boolean(ANTHROPIC_API_KEY || GEMINI_API_KEY);

async function callClaude(system, user, maxTokens = 1000) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

async function callGemini(system, user, jsonMode = false) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  
  const payload = {
    contents: [{ parts: [{ text: user }] }]
  };
  
  if (system) {
    payload.systemInstruction = { parts: [{ text: system }] };
  }
  
  if (jsonMode) {
    payload.generationConfig = {
      responseMimeType: 'application/json',
      temperature: 0.1
    };
  } else {
    payload.generationConfig = {
      temperature: 0.7
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini API');
  return text;
}

async function callLLM(system, user, maxTokens = 1000, jsonMode = false) {
  if (GEMINI_API_KEY) {
    return callGemini(system, user, jsonMode);
  }
  if (ANTHROPIC_API_KEY) {
    return callClaude(system, user, maxTokens);
  }
  throw new Error('No AI API key configured');
}


const stripFences = (t) => t.replace(/```(?:json)?/g, '').trim();

// ---------------------------------------------------------------- 1. Segments

const SEGMENT_SYSTEM = `You translate a marketer's audience description into a JSON rule object for a coffee-chain CRM. Respond with ONLY JSON, no prose, shaped as:
{"logic":"AND"|"OR","conditions":[{"field":...,"op":...,"value":...}]}
Fields: total_spend (₹ lifetime), order_count, avg_order_value (₹), last_order_days (days since last order; "inactive 3 months" => last_order_days > 90; "ordered recently/this month" => last_order_days <= 30), tenure_days (days since joining), city (string).
Ops for numbers: > >= < <= = != ; for city: = != contains.
Use AND unless the ask is clearly "either/or". Convert k to thousands (5k => 5000). If the ask is impossible with these fields, respond {"error":"<short reason>"}.`;

// Fallback: a small pattern parser for the most common marketer phrasings.
function heuristicSegment(prompt) {
  const p = prompt.toLowerCase().replace(/,/g, '');
  const conditions = [];
  const num = (s) => {
    let v = parseFloat(s.replace(/[₹$\s]/g, ''));
    if (/k\b/.test(s)) v *= 1000;
    return v;
  };
  let m;
  if ((m = p.match(/(?:spen[dt]\w*|spend(?:ing)?)[^\d₹$]*(over|above|more than|>|under|below|less than|<)?\s*([₹$]?\s?[\d.]+\s?k?)/)))
    conditions.push({ field: 'total_spend', op: /under|below|less|</.test(m[1] || '') ? '<' : '>', value: num(m[2]) });
  if ((m = p.match(/(more than|over|at least|fewer than|less than|under)?\s*(\d+)\s*(?:\+\s*)?orders?/)))
    conditions.push({ field: 'order_count', op: /fewer|less|under/.test(m[1] || '') ? '<' : '>=', value: parseInt(m[2]) });
  if ((m = p.match(/(?:inactive|haven'?t (?:ordered|shopped|visited)|not (?:ordered|shopped)|no orders?|last order(?:ed)? (?:over|more than))\D*(\d+)\s*(day|week|month)/)))
    conditions.push({ field: 'last_order_days', op: '>', value: parseInt(m[1]) * (m[2] === 'month' ? 30 : m[2] === 'week' ? 7 : 1) });
  if ((m = p.match(/(?:ordered|shopped|active|visited)[^.]{0,20}(?:in the )?(?:last|past|within)\s*(\d+)\s*(day|week|month)/)))
    conditions.push({ field: 'last_order_days', op: '<=', value: parseInt(m[1]) * (m[2] === 'month' ? 30 : m[2] === 'week' ? 7 : 1) });
  for (const city of ['delhi', 'mumbai', 'bengaluru', 'bangalore', 'pune', 'hyderabad', 'chennai', 'gurugram', 'noida'])
    if (p.includes(city))
      conditions.push({ field: 'city', op: '=', value: city === 'bangalore' ? 'Bengaluru' : city[0].toUpperCase() + city.slice(1) });
  if ((m = p.match(/new (?:customers?|shoppers?|members?)/)))
    conditions.push({ field: 'tenure_days', op: '<=', value: 90 });
  if (conditions.length === 0)
    throw new Error('Could not parse that audience. Try patterns like "spent over ₹5000 and inactive 90 days", or configure an API key for full natural-language understanding.');
  return { logic: /\beither\b|\bor\b(?!ders)/.test(p) ? 'OR' : 'AND', conditions };
}

export async function nlToSegment(prompt) {
  if (!aiEnabled()) return { rules: validateRules(heuristicSegment(prompt)), source: 'heuristic' };
  const raw = await callLLM(SEGMENT_SYSTEM, prompt, 600, true);
  const parsed = JSON.parse(stripFences(raw));
  if (parsed.error) throw new Error(parsed.error);
  return { rules: validateRules(parsed), source: GEMINI_API_KEY ? 'gemini' : 'claude' };
}

// ---------------------------------------------------------------- 2. Drafting

function getDraftSystemPrompt(brand = 'Brew & Bloom') {
  return `You write marketing messages for ${brand}, a warm specialty coffee chain in India. Voice: friendly, specific, never pushy; rupee offers feel generous but plausible.
Personalization tokens allowed (exactly these): {{first_name}}, {{city}}, {{total_spend}}, {{last_order_days}}.
Respond with ONLY JSON: {"variants":[{"label":"<2-4 word angle>","text":"<message>"}]} — exactly 3 variants with genuinely different angles (e.g. warm win-back vs. concrete offer vs. playful). Respect channel limits: SMS <= 160 chars, WHATSAPP/RCS <= 300, EMAIL <= 500 (email may use 1-2 short paragraphs).`;
}

function heuristicDrafts(objective, channel, brand = 'Brew & Bloom') {
  const short = channel === 'SMS';
  return [
    { label: 'Warm & personal', text: short
      ? `Hi {{first_name}}, we miss you at ${brand}! Your next coffee is on us with 20% off this week. See you soon ☕`
      : `Hi {{first_name}}, it's been a while since your last visit — and your usual spot at ${brand} is waiting. Here's 20% off anything on the menu this week. ☕` },
    { label: 'Concrete offer', text: short
      ? `{{first_name}}, flat ₹150 off your next ${brand} order over ₹500. Valid 7 days. Tap to redeem.`
      : `{{first_name}}, here's something for you: flat ₹150 off your next order over ₹500 at ${brand}, {{city}}. Valid for 7 days — your favourites are exactly where you left them.` },
    { label: 'Playful nudge', text: short
      ? `Your coffee called, {{first_name}} — it misses you. Come back this week for 20% off at ${brand}.`
      : `{{first_name}}, your flat white filed a missing-person report. 😄 Close the case this week with 20% off at ${brand} — we'll have it ready.` },
  ];
}

export async function draftMessages({ objective, audienceSummary, channel, brand }) {
  const brandName = brand || 'Brew & Bloom';
  if (!aiEnabled()) return { variants: heuristicDrafts(objective, channel, brandName), source: 'heuristic' };
  const raw = await callLLM(
    getDraftSystemPrompt(brandName),
    `Channel: ${channel}\nAudience: ${audienceSummary}\nCampaign objective: ${objective}`,
    900,
    true
  );
  const parsed = JSON.parse(stripFences(raw));
  if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) throw new Error('Bad draft response');
  return { variants: parsed.variants.slice(0, 3), source: GEMINI_API_KEY ? 'gemini' : 'claude' };
}

// ---------------------------------------------------------------- 3. Insights

const INSIGHT_SYSTEM = `You are a CRM analyst. Given campaign funnel stats as JSON, write a 3-4 sentence plain-English performance summary for a marketer: what stands out, one comparison to typical benchmarks (delivery ~90-95%, open ~40-60% on WhatsApp, click ~8-15%), and one concrete next action. No headers, no bullets, no fluff.`;

function heuristicInsight(s) {
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const parts = [
    `This campaign reached ${s.audience_size} shoppers; ${s.delivered} messages were delivered (${pct(s.delivered, s.sent)}% delivery) and ${s.failed} failed.`,
  ];
  if (s.opened) parts.push(`${pct(s.opened, s.delivered)}% of delivered messages were opened and ${pct(s.clicked, s.opened)}% of those clicked through.`);
  if (s.converted) parts.push(`${s.converted} shoppers placed an order from this campaign, attributing ₹${Math.round(s.revenue).toLocaleString('en-IN')} in revenue.`);
  parts.push(s.failed > s.sent * 0.1
    ? `Delivery failures are above the ~10% you'd expect — worth checking number hygiene before the next send.`
    : `A follow-up to openers who didn't click is the highest-leverage next step.`);
  return parts.join(' ');
}

export async function campaignInsight(stats) {
  if (!aiEnabled()) return { text: heuristicInsight(stats), source: 'heuristic' };
  const text = await callLLM(INSIGHT_SYSTEM, JSON.stringify(stats), 400, false);
  return { text: text.trim(), source: GEMINI_API_KEY ? 'gemini' : 'claude' };
}
