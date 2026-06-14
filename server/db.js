// db.js — MongoDB persistence layer client
import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/relay').trim();
const client = new MongoClient(MONGODB_URI);

let dbInstance = null;

export async function connectDB() {
  if (dbInstance) return dbInstance;
  
  await client.connect();
  dbInstance = client.db();
  
  // Set up indexes
  await dbInstance.collection('users').createIndex({ email: 1 }, { unique: true });
  await dbInstance.collection('sessions').createIndex({ token: 1 }, { unique: true });
  await dbInstance.collection('customers').createIndex({ email: 1 });
  await dbInstance.collection('orders').createIndex({ customer_id: 1 });
  await dbInstance.collection('segments').createIndex({ created_at: -1 });
  await dbInstance.collection('campaigns').createIndex({ created_at: -1 });
  await dbInstance.collection('communications').createIndex({ campaign_id: 1 });
  await dbInstance.collection('receipt_events').createIndex({ event_id: 1 }, { unique: true });
  
  return dbInstance;
}

export function getCollection(name) {
  if (!dbInstance) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return dbInstance.collection(name);
}

export const now = () => new Date().toISOString();
export { ObjectId };
