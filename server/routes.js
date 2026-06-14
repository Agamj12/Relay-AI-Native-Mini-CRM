// routes.js — the HTTP surface of the CRM, grouped by resource (MongoDB version).
import { Router } from 'express';
import crypto from 'node:crypto';
import { getCollection, now, ObjectId } from './db.js';
import { previewSegment, resolveSegment, describeRules, validateRules } from './services/segmentEngine.js';
import { nlToSegment, draftMessages, campaignInsight, aiEnabled } from './services/ai.js';
import { launchCampaign } from './services/dispatcher.js';
import { enqueueReceipts } from './services/receiptQueue.js';

export const api = Router();

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};

// --- Cryptographic helper utilities for authentication ---
const generateSalt = () => crypto.randomBytes(16).toString('hex');
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const generateToken = () => crypto.randomBytes(32).toString('hex');

const SESSION_EXPIRY_DAYS = 30;
const getExpiryDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_EXPIRY_DAYS);
  return d.toISOString();
};

// --- Middleware: authentication check ---
const requireAuth = async (req, res, next) => {
  const publicPaths = ['/auth/login', '/auth/signup', '/receipts', '/receipts/batch', '/health'];
  if (publicPaths.some(p => req.path === p || req.path.startsWith(p))) {
    return next();
  }

  if (process.env.DISABLE_AUTH === 'true') {
    req.user = { id: '111111111111111111111111', email: 'test@example.com', name: 'Test User' };
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const session = await getCollection('sessions').findOne({ token });
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    if (new Date(session.expires_at) < new Date()) {
      await getCollection('sessions').deleteOne({ token });
      return res.status(401).json({ error: 'Unauthorized: Session expired' });
    }

    const user = await getCollection('users').findOne({ _id: new ObjectId(session.user_id) });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }

    req.user = { id: user._id.toString(), email: user.email, name: user.name };
    req.token = token;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

api.use(requireAuth);

// --- Auth Endpoints ---
api.post('/auth/signup', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email, and password are required');
  }
  if (!email.includes('@')) {
    res.status(400);
    throw new Error('Invalid email format');
  }
  if (password.length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const existing = await getCollection('users').findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409);
    throw new Error('Email already registered');
  }

  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  const userDoc = {
    name,
    email: email.toLowerCase(),
    password_hash: hash,
    salt,
    created_at: new Date()
  };
  const userInsert = await getCollection('users').insertOne(userDoc);
  const user_id = userInsert.insertedId;

  const token = generateToken();
  const expires = getExpiryDate();
  await getCollection('sessions').insertOne({
    token,
    user_id,
    expires_at: new Date(expires),
    created_at: new Date()
  });

  res.status(201).json({
    token,
    user: { id: user_id.toString(), name, email: email.toLowerCase() }
  });
}));

api.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  const user = await getCollection('users').findOne({ email: email.toLowerCase() });
  if (!user) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  const hash = hashPassword(password, user.salt);
  if (hash !== user.password_hash) {
    res.status(401);
    throw new Error('Invalid email or password');
  }

  const token = generateToken();
  const expires = getExpiryDate();
  await getCollection('sessions').insertOne({
    token,
    user_id: user._id,
    expires_at: new Date(expires),
    created_at: new Date()
  });

  res.json({
    token,
    user: { id: user._id.toString(), name: user.name, email: user.email }
  });
}));

api.post('/auth/logout', wrap(async (req, res) => {
  if (req.token) {
    await getCollection('sessions').deleteOne({ token: req.token });
  }
  res.json({ ok: true });
}));

api.get('/auth/me', wrap((req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error('Not authenticated');
  }
  res.json({ user: req.user });
}));

// ---------------------------------------------------------------- overview

async function campaignStats(id) {
  const stats = await getCollection('communications').aggregate([
    { $match: { campaign_id: new ObjectId(id) } },
    {
      $group: {
        _id: null,
        audience_size: { $sum: 1 },
        sent: { $sum: { $cond: [{ $ne: ['$status', 'QUEUED'] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        opened: { $sum: { $cond: [{ $gt: ['$opened_at', null] }, 1, 0] } },
        clicked: { $sum: { $cond: [{ $gt: ['$clicked_at', null] }, 1, 0] } },
        converted: { $sum: { $cond: [{ $gt: ['$converted_at', null] }, 1, 0] } },
        revenue: { $sum: '$converted_amount' }
      }
    }
  ]).toArray();

  return stats[0] || {
    audience_size: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    opened: 0,
    clicked: 0,
    converted: 0,
    revenue: 0
  };
}

api.get('/overview', wrap(async (req, res) => {
  const customersCount = await getCollection('customers').countDocuments();
  
  const ordersStats = await getCollection('orders').aggregate([
    { $group: { _id: null, n: { $sum: 1 }, rev: { $sum: '$amount' } } }
  ]).toArray();
  const orders = ordersStats[0] || { n: 0, rev: 0 };
  
  const campaignsCount = await getCollection('campaigns').countDocuments();
  
  const attributedStats = await getCollection('orders').aggregate([
    { $match: { source_campaign_id: { $ne: null } } },
    { $group: { _id: null, n: { $sum: 1 }, rev: { $sum: '$amount' } } }
  ]).toArray();
  const attributed = attributedStats[0] || { n: 0, rev: 0 };
  
  const recentCampaigns = await getCollection('campaigns').find().sort({ created_at: -1 }).limit(5).toArray();
  
  const recentWithStats = [];
  for (const c of recentCampaigns) {
    const stats = await campaignStats(c._id);
    recentWithStats.push({
      ...c,
      id: c._id.toString(),
      segment_id: c.segment_id.toString(),
      ...stats
    });
  }

  res.json({
    customers: customersCount,
    orders: orders.n,
    revenue: orders.rev,
    campaigns: campaignsCount,
    attributed_orders: attributed.n,
    attributed_revenue: attributed.rev,
    recent_campaigns: recentWithStats,
    ai_enabled: aiEnabled(),
    ai_provider: process.env.GEMINI_API_KEY ? 'Gemini' : (process.env.ANTHROPIC_API_KEY ? 'Claude' : null),
  });
}));

api.get('/customers', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const pipeline = [
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'customer_id',
        as: 'orders'
      }
    },
    {
      $project: {
        first_name: 1,
        last_name: 1,
        email: 1,
        phone: 1,
        city: 1,
        consent_email: 1,
        consent_sms: 1,
        consent_whatsapp: 1,
        created_at: 1,
        order_count: { $size: '$orders' },
        total_spend: { $sum: '$orders.amount' },
        last_order_days: {
          $cond: [
            { $gt: [{ $size: '$orders' }, 0] },
            {
              $floor: {
                $divide: [
                  { $subtract: [new Date(), { $max: '$orders.created_at' }] },
                  1000 * 60 * 60 * 24
                ]
              }
            },
            null
          ]
        }
      }
    },
    { $sort: { total_spend: -1 } },
    { $limit: limit }
  ];
  
  const customersList = await getCollection('customers').aggregate(pipeline).toArray();
  res.json(customersList.map(c => ({ ...c, id: c._id.toString() })));
}));

// Ingest API: accepts customers (with optional inline orders) in bulk.
api.post('/ingest', wrap(async (req, res) => {
  const { customers = [] } = req.body;
  if (!Array.isArray(customers) || customers.length === 0) throw new Error('customers must be a non-empty array');
  
  const customersColl = getCollection('customers');
  const ordersColl = getCollection('orders');
  
  let nOrders = 0;
  for (const c of customers) {
    if (!c.first_name || !c.email) throw new Error('each customer needs at least first_name and email');
    const customerDoc = {
      first_name: c.first_name,
      last_name: c.last_name || '',
      email: c.email.toLowerCase(),
      phone: c.phone || '',
      city: c.city || '',
      consent_email: c.consent_email ?? 1,
      consent_sms: c.consent_sms ?? 1,
      consent_whatsapp: c.consent_whatsapp ?? 1,
      created_at: c.created_at ? new Date(c.created_at) : new Date()
    };
    const resCust = await customersColl.insertOne(customerDoc);
    const id = resCust.insertedId;
    
    for (const o of c.orders || []) {
      await ordersColl.insertOne({
        customer_id: id,
        amount: o.amount,
        items: o.items || '',
        created_at: o.created_at ? new Date(o.created_at) : new Date()
      });
      nOrders++;
    }
  }
  
  res.status(201).json({ ingested_customers: customers.length, ingested_orders: nOrders });
}));

// ---------------------------------------------------------------- segments

// Natural language → rules + live preview. Nothing is saved yet.
api.post('/segments/preview', wrap(async (req, res) => {
  const { prompt, rules } = req.body;
  let resolved, source = 'manual';
  if (rules) resolved = validateRules(rules);
  else if (prompt) ({ rules: resolved, source } = await nlToSegment(prompt));
  else throw new Error('provide a prompt or rules');
  const { size, sample } = await previewSegment(resolved);
  res.json({ rules: resolved, description: describeRules(resolved), size, sample, source });
}));

api.post('/segments', wrap(async (req, res) => {
  const { name, prompt, rules } = req.body;
  if (!name || !rules) throw new Error('name and rules are required');
  const valid = validateRules(rules);
  const { size } = await previewSegment(valid);
  
  const segmentDoc = {
    name,
    prompt: prompt || null,
    description: describeRules(valid),
    rules_json: JSON.stringify(valid),
    size_snapshot: size,
    created_at: new Date()
  };
  
  const insertRes = await getCollection('segments').insertOne(segmentDoc);
  const segment = await getCollection('segments').findOne({ _id: insertRes.insertedId });
  res.status(201).json({ ...segment, id: segment._id.toString() });
}));

api.get('/segments', wrap(async (req, res) => {
  const segs = await getCollection('segments').find().sort({ created_at: -1 }).toArray();
  const results = [];
  for (const s of segs) {
    const live = await previewSegment(JSON.parse(s.rules_json), { limit: 0 });
    results.push({ ...s, id: s._id.toString(), live_size: live.size });
  }
  res.json(results);
}));

// ---------------------------------------------------------------- AI helpers

api.post('/ai/draft', wrap(async (req, res) => {
  const { objective, segment_id, channel, brand } = req.body;
  if (!objective || !channel) throw new Error('objective and channel are required');
  let audienceSummary = 'all shoppers';
  if (segment_id) {
    const s = await getCollection('segments').findOne({ _id: new ObjectId(segment_id) });
    if (s) audienceSummary = `${s.name} — ${s.description} (${s.size_snapshot} shoppers)`;
  }
  res.json(await draftMessages({ objective, audienceSummary, channel, brand }));
}));

// ---------------------------------------------------------------- campaigns

api.post('/campaigns', wrap(async (req, res) => {
  const { name, objective, segment_id, channel, message_template, brand } = req.body;
  if (!name || !segment_id || !channel || !message_template) throw new Error('name, segment_id, channel and message_template are required');
  if (!/\S/.test(message_template)) throw new Error('message cannot be empty');
  
  const seg = await getCollection('segments').findOne({ _id: new ObjectId(segment_id) });
  if (!seg) throw new Error('segment not found');

  const campDoc = {
    name,
    objective: objective || null,
    segment_id: new ObjectId(segment_id),
    channel,
    message_template,
    brand: brand || 'Brew & Bloom',
    status: 'DRAFT',
    audience_size: 0,
    created_at: new Date()
  };
  
  const insertRes = await getCollection('campaigns').insertOne(campDoc);
  const campaign = await getCollection('campaigns').findOne({ _id: insertRes.insertedId });
  const campaignWithId = { ...campaign, id: campaign._id.toString() };

  // Resolve audience at launch time with channel consent enforced.
  const audience = await resolveSegment(JSON.parse(seg.rules_json), { channel });
  if (audience.length === 0) throw new Error('audience is empty for this channel (after consent filtering)');
  const sent = await launchCampaign(campaignWithId, audience);
  
  const updatedCampaign = await getCollection('campaigns').findOne({ _id: campaign._id });
  res.status(201).json({ ...updatedCampaign, id: updatedCampaign._id.toString(), queued: sent });
}));

api.get('/campaigns', wrap(async (req, res) => {
  const campaigns = await getCollection('campaigns').find().sort({ created_at: -1 }).toArray();
  const results = [];
  for (const c of campaigns) {
    const seg = await getCollection('segments').findOne({ _id: c.segment_id });
    const stats = await campaignStats(c._id);
    results.push({
      ...c,
      id: c._id.toString(),
      segment_name: seg ? seg.name : 'Unknown Segment',
      ...stats
    });
  }
  res.json(results);
}));

api.get('/campaigns/:id', wrap(async (req, res) => {
  const c = await getCollection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
  if (!c) return res.status(404).json({ error: 'campaign not found' });
  const seg = await getCollection('segments').findOne({ _id: c.segment_id });
  
  const stats = await campaignStats(c._id);
  
  // Recent events (join receipt_events, communications, customers)
  const recent_events = await getCollection('receipt_events').aggregate([
    {
      $lookup: {
        from: 'communications',
        localField: 'communication_id',
        foreignField: '_id',
        as: 'comm'
      }
    },
    { $unwind: '$comm' },
    { $match: { 'comm.campaign_id': c._id } },
    {
      $lookup: {
        from: 'customers',
        localField: 'comm.customer_id',
        foreignField: '_id',
        as: 'cust'
      }
    },
    { $unwind: '$cust' },
    { $sort: { received_at: -1 } },
    { $limit: 40 },
    {
      $project: {
        type: 1,
        received_at: 1,
        communication_id: 1,
        first_name: '$cust.first_name',
        last_name: '$cust.last_name'
      }
    }
  ]).toArray();
  
  // Sample communications
  const sample_comms = await getCollection('communications').aggregate([
    { $match: { campaign_id: c._id } },
    {
      $lookup: {
        from: 'customers',
        localField: 'customer_id',
        foreignField: '_id',
        as: 'cust'
      }
    },
    { $unwind: '$cust' },
    { $limit: 12 },
    {
      $project: {
        id: '$_id',
        status: 1,
        rendered_message: 1,
        opened_at: 1,
        clicked_at: 1,
        converted_at: 1,
        failure_reason: 1,
        first_name: '$cust.first_name',
        last_name: '$cust.last_name'
      }
    }
  ]).toArray();

  res.json({
    ...c,
    id: c._id.toString(),
    segment_name: seg ? seg.name : 'Unknown Segment',
    segment_description: seg ? seg.description : '',
    ...stats,
    recent_events: recent_events.map(e => ({ ...e, communication_id: e.communication_id.toString() })),
    sample_comms: sample_comms.map(co => ({ ...co, id: co.id.toString() }))
  });
}));

api.post('/campaigns/:id/insight', wrap(async (req, res) => {
  const c = await getCollection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
  if (!c) return res.status(404).json({ error: 'campaign not found' });
  const stats = await campaignStats(c._id);
  res.json(await campaignInsight({ name: c.name, channel: c.channel, ...stats }));
}));

// ---------------------------------------------------------------- receipts
// Called by the channel service. Acks immediately; processing is async + batched.

api.post('/receipts/batch', (req, res) => {
  const { events } = req.body || {};
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' });
  const depth = enqueueReceipts(events);
  res.status(202).json({ accepted: events.length, queue_depth: depth });
});

api.post('/receipts', (req, res) => {
  const e = req.body || {};
  if (!e.communication_id || !e.type) return res.status(400).json({ error: 'communication_id and type are required' });
  enqueueReceipts([e]);
  res.status(202).json({ accepted: 1 });
});
