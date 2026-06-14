// dispatcher.js — pushes a campaign's communications to the channel service (MongoDB version).
import { getCollection, ObjectId } from '../db.js';

const CHANNEL_URL = process.env.CHANNEL_URL || 'http://localhost:4100';
const SELF_URL = process.env.CRM_URL || 'http://localhost:4000';
const BATCH_SIZE = 50;

const TOKENS = {
  first_name: (c) => c.first_name,
  city: (c) => c.city,
  total_spend: (c) => `₹${Math.round(c.total_spend).toLocaleString('en-IN')}`,
  last_order_days: (c) => `${c.last_order_days}`,
};

export function renderMessage(template, customer) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    TOKENS[key] ? TOKENS[key](customer) : `{{${key}}}`
  );
}

export async function launchCampaign(campaign, audience) {
  const commsColl = getCollection('communications');
  const docs = audience.map(c => ({
    campaign_id: new ObjectId(campaign.id),
    customer_id: new ObjectId(c.id),
    channel: campaign.channel,
    rendered_message: renderMessage(campaign.message_template, c),
    status: 'QUEUED',
    created_at: new Date(),
    updated_at: new Date()
  }));

  const res = await commsColl.insertMany(docs);
  
  const comms = docs.map((doc, idx) => ({
    id: res.insertedIds[idx].toString(),
    customer: audience[idx]
  }));

  await getCollection('campaigns').updateOne(
    { _id: new ObjectId(campaign.id) },
    { $set: { status: 'SENDING', audience_size: comms.length, launched_at: new Date() } }
  );

  // Dispatch in the background; the API call returns immediately.
  dispatch(campaign, comms).catch((e) => console.error('[dispatcher]', e.message));
  return comms.length;
}

async function dispatch(campaign, comms) {
  const commsColl = getCollection('communications');

  for (let i = 0; i < comms.length; i += BATCH_SIZE) {
    const batch = comms.slice(i, i + BATCH_SIZE);
    const payload = {
      callback_url: `${SELF_URL}/api/receipts/batch`,
      messages: batch.map((b) => ({
        communication_id: b.id,
        channel: campaign.channel,
        recipient: campaign.channel === 'EMAIL' ? b.customer.email : b.customer.phone,
        body_preview: undefined,
      })),
    };
    try {
      const res = await fetch(`${CHANNEL_URL}/v1/send/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status !== 202) throw new Error(`channel responded ${res.status}`);
      
      await commsColl.updateMany(
        { _id: { $in: batch.map(b => new ObjectId(b.id)) }, status: 'QUEUED' },
        { $set: { status: 'SENT', updated_at: new Date() } }
      );
    } catch (e) {
      await commsColl.updateMany(
        { _id: { $in: batch.map(b => new ObjectId(b.id)) } },
        { $set: { status: 'FAILED', failure_reason: `dispatch error: ${e.message}`, updated_at: new Date() } }
      );
    }
  }
  
  await getCollection('campaigns').updateOne(
    { _id: new ObjectId(campaign.id) },
    { $set: { status: 'ACTIVE' } }
  );
}
