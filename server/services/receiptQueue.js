// receiptQueue.js — ingestion path for channel callbacks (MongoDB version).
import { getCollection, ObjectId } from '../db.js';
import { randomUUID } from 'node:crypto';

const buffer = [];
let flushTimer = null;
const FLUSH_MS = 400;

export function enqueueReceipts(events) {
  for (const e of events) buffer.push(e);
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  return buffer.length;
}

async function flush() {
  flushTimer = null;
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);

  try {
    const receiptEventsColl = getCollection('receipt_events');
    const communicationsColl = getCollection('communications');
    const ordersColl = getCollection('orders');

    for (const e of batch) {
      const eventId = e.event_id || randomUUID();
      
      let fresh = false;
      try {
        await receiptEventsColl.insertOne({
          event_id: eventId,
          communication_id: new ObjectId(e.communication_id),
          type: e.type,
          payload: e,
          received_at: new Date()
        });
        fresh = true;
      } catch (err) {
        // Code 11000 is duplicate key error (already processed this event)
        if (err.code !== 11000) {
          throw err;
        }
      }

      if (!fresh) continue;

      switch (e.type) {
        case 'DELIVERED':
          await communicationsColl.updateOne(
            { _id: new ObjectId(e.communication_id), status: { $in: ['QUEUED', 'SENT'] } },
            { $set: { status: 'DELIVERED', updated_at: new Date() } }
          );
          break;
        case 'FAILED':
          await communicationsColl.updateOne(
            { _id: new ObjectId(e.communication_id), status: { $in: ['QUEUED', 'SENT'] } },
            { $set: { status: 'FAILED', failure_reason: e.reason || 'provider failure', updated_at: new Date() } }
          );
          break;
        case 'OPENED': {
          const comm = await communicationsColl.findOne({ _id: new ObjectId(e.communication_id) });
          if (comm && comm.status !== 'FAILED') {
            const updateDoc = { $set: { status: 'DELIVERED', updated_at: new Date() } };
            if (!comm.opened_at) updateDoc.$set.opened_at = e.at ? new Date(e.at) : new Date();
            await communicationsColl.updateOne({ _id: comm._id }, updateDoc);
          }
          break;
        }
        case 'CLICKED': {
          const comm = await communicationsColl.findOne({ _id: new ObjectId(e.communication_id) });
          if (comm && comm.status !== 'FAILED') {
            const updateDoc = { $set: { status: 'DELIVERED', updated_at: new Date() } };
            if (!comm.clicked_at) updateDoc.$set.clicked_at = e.at ? new Date(e.at) : new Date();
            if (!comm.opened_at) updateDoc.$set.opened_at = e.at ? new Date(e.at) : new Date();
            await communicationsColl.updateOne({ _id: comm._id }, updateDoc);
          }
          break;
        }
        case 'CONVERTED': {
          const comm = await communicationsColl.findOne({ _id: new ObjectId(e.communication_id) });
          if (comm && comm.status !== 'FAILED' && !comm.converted_at) {
            await communicationsColl.updateOne(
              { _id: comm._id },
              {
                $set: {
                  converted_at: e.at ? new Date(e.at) : new Date(),
                  converted_amount: e.amount || 0,
                  updated_at: new Date()
                }
              }
            );
            // Attribution: the conversion becomes a real order, tagged to the campaign.
            await ordersColl.insertOne({
              customer_id: comm.customer_id,
              amount: e.amount || 0,
              items: 'Campaign order',
              source_campaign_id: comm.campaign_id,
              created_at: new Date()
            });
          }
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    console.error('[receipts] flush failed:', err.message);
  }

  if (buffer.length > 0) flushTimer = setTimeout(flush, FLUSH_MS);
}
