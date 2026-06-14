// seed.js — generates realistic, well-shaped demo data for "Brew & Bloom",
// a fictional specialty coffee chain. Deliberately non-uniform: spend follows a
// rough power law, recency is mixed (loyal regulars + lapsed shoppers), so that
// segmentation queries return interesting, believable audiences.

import { getCollection, ObjectId } from './db.js';

const FIRST = ['Aarav','Ananya','Vihaan','Diya','Kabir','Ishita','Rohan','Meera','Arjun','Sara','Dev','Priya','Aditya','Naina','Kunal','Tara','Reyansh','Zoya','Nikhil','Anika','Samar','Rhea','Yash','Mira','Aryan','Kavya','Veer','Inaaya','Rahul','Pooja','Karan','Sneha','Aman','Ritika','Siddharth','Avni','Manav','Jiya','Harsh','Shreya'];
const LAST = ['Sharma','Verma','Iyer','Patel','Reddy','Khan','Mehta','Nair','Gupta','Singh','Bose','Chopra','Desai','Joshi','Kapoor','Malhotra','Menon','Pillai','Rao','Saxena','Bhatia','Kulkarni','Dutta','Ahuja'];
const CITIES = ['Delhi','Mumbai','Bengaluru','Pune','Hyderabad','Chennai','Gurugram','Noida'];
const ITEMS = ['Flat White','Cold Brew','Hazelnut Latte','Vienna Roast 250g','Almond Croissant','Masala Chai','Single-Origin Pourover','Mocha','Banana Bread','Espresso Tonic','Affogato','House Blend 500g'];

const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];
const daysAgo = (d) => new Date(Date.now() - d * 864e5);

export async function seedIfEmpty() {
  const customersColl = getCollection('customers');
  const ordersColl = getCollection('orders');

  const count = await customersColl.countDocuments();
  if (count > 0) return { seeded: false, customers: count };

  const N = 600;
  const customers = [];
  const orders = [];

  for (let i = 0; i < N; i++) {
    const fn = pick(FIRST), ln = pick(LAST);
    const tenure = 30 + rand(700); // joined between 1 and ~24 months ago
    const customerId = new ObjectId();

    customers.push({
      _id: customerId,
      first_name: fn,
      last_name: ln,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}${rand(999)}@example.com`,
      phone: `+91${7000000000 + rand(999999999)}`,
      city: pick(CITIES),
      consent_email: Math.random() < 0.96 ? 1 : 0,
      consent_sms: Math.random() < 0.9 ? 1 : 0,
      consent_whatsapp: Math.random() < 0.82 ? 1 : 0,
      created_at: daysAgo(tenure),
    });

    // Shopper archetypes → believable distributions for segmentation demos.
    const r = Math.random();
    let orderCount, recencyMin = 0, recencyMax;
    if (r < 0.15)      { orderCount = 8 + rand(18); recencyMax = 21; }                    // regulars
    else if (r < 0.30) { orderCount = 6 + rand(10); recencyMin = 90; recencyMax = 300; }  // lapsed VIPs (winback gold)
    else if (r < 0.55) { orderCount = 3 + rand(6);  recencyMax = 60; }                    // occasionals
    else if (r < 0.80) { orderCount = 1 + rand(3);  recencyMax = 240; }                   // lapsing
    else               { orderCount = 1 + rand(2);  recencyMax = 540; }                   // dormant

    for (let o = 0; o < orderCount; o++) {
      const nItems = 1 + rand(3);
      const items = Array.from({ length: nItems }, () => pick(ITEMS));
      const amount = Math.round((nItems * (180 + rand(420))) / 10) * 10;
      const span = Math.max(1, Math.min(recencyMax, tenure) - recencyMin);
      
      orders.push({
        customer_id: customerId,
        amount,
        items: items.join(', '),
        created_at: daysAgo(recencyMin + rand(span)),
      });
    }
  }

  await customersColl.insertMany(customers);
  await ordersColl.insertMany(orders);

  return { seeded: true, customers: N };
}
