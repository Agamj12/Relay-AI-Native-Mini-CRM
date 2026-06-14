#!/usr/bin/env bash
# e2e.sh — boots both services and exercises the full loop:
# ingest → NL segment preview → save → AI draft → campaign launch → receipts → stats.
set -e
cd "$(dirname "$0")"
rm -rf data
node --no-warnings backend/channel/index.js > /tmp/channel.log 2>&1 & CH=$!
node --no-warnings backend/server/index.js  > /tmp/server.log  2>&1 & SV=$!
trap "kill $CH $SV 2>/dev/null" EXIT
sleep 2

echo '== authenticate =='
AUTH_RESP=$(curl -s -X POST localhost:4000/api/auth/signup -H 'content-type: application/json' -d '{"name":"E2E User","email":"e2e@example.com","password":"password123"}')
TOKEN=$(echo "$AUTH_RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.token || '')})")
if [ -z "$TOKEN" ]; then
  AUTH_RESP=$(curl -s -X POST localhost:4000/api/auth/login -H 'content-type: application/json' -d '{"email":"e2e@example.com","password":"password123"}')
  TOKEN=$(echo "$AUTH_RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.token || '')})")
fi
echo "auth token retrieved successfully!"

echo; echo '== overview =='; curl -s localhost:4000/api/overview -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log({customers:j.customers,orders:j.orders,revenue:Math.round(j.revenue)})})"

echo; echo '== NL segment preview (fallback parser) =='
curl -s localhost:4000/api/segments/preview -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"prompt":"shoppers who spent over ₹5000 but have been inactive for 3 months"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log({rules:j.rules,description:j.description,size:j.size,source:j.source})})"

echo; echo '== save segment =='
SEG=$(curl -s localhost:4000/api/segments -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"High-value lapsed","prompt":"spent over 5000, inactive 90 days","rules":{"logic":"AND","conditions":[{"field":"total_spend","op":">","value":5000},{"field":"last_order_days","op":">","value":90}]}}')
echo "$SEG" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log({id:j.id,size:j.size_snapshot})})"
SEG_ID=$(echo "$SEG" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")

echo; echo '== AI draft (fallback) =='
curl -s localhost:4000/api/ai/draft -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"objective\":\"win back lapsed high spenders with a 20% offer\",\"segment_id\":$SEG_ID,\"channel\":\"WHATSAPP\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.variants.map(v=>v.label))})"

echo; echo '== launch campaign =='
CAMP=$(curl -s localhost:4000/api/campaigns -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"name\":\"Winback June\",\"objective\":\"win back lapsed high spenders\",\"segment_id\":$SEG_ID,\"channel\":\"WHATSAPP\",\"message_template\":\"Hi {{first_name}}, we miss you! 20% off this week at Brew & Bloom {{city}}.\"}")
echo "$CAMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log({id:j.id,queued:j.queued,status:j.status})})"
CAMP_ID=$(echo "$CAMP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")

echo; echo '== stats over time (receipts streaming in) =='
for t in 4 8 12 16; do
  sleep 4
  curl -s localhost:4000/api/campaigns/$CAMP_ID -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('t+${t}s', {sent:j.sent,delivered:j.delivered,failed:j.failed,opened:j.opened,clicked:j.clicked,converted:j.converted,revenue:j.revenue})})"
done

echo; echo '== idempotency: replay a receipt event =='
EV=$(node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/relay');
client.connect().then(() => {
  const db = client.db();
  return db.collection('receipt_events').findOne({});
}).then(r => {
  console.log(JSON.stringify({event_id:r.event_id, communication_id:r.communication_id.toString(), type:r.type}));
  return client.close();
}).catch(() => process.exit(1));
")
curl -s localhost:4000/api/receipts -H 'content-type: application/json' -d "$EV" > /dev/null
sleep 1
node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/relay');
const ev = JSON.parse(process.argv[1]);
client.connect().then(() => {
  const db = client.db();
  return db.collection('receipt_events').countDocuments({ event_id: ev.event_id });
}).then(n => {
  console.log('ledger rows for replayed event_id:', n, n===1?'(idempotent ✓)':'(DUPLICATED ✗)');
  return client.close();
}).catch(() => process.exit(1));
" "$EV"

echo; echo '== AI insight (fallback) =='
curl -s -X POST localhost:4000/api/campaigns/$CAMP_ID/insight -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).text))"

echo; echo '== attributed revenue on dashboard =='
curl -s localhost:4000/api/overview -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log({attributed_orders:j.attributed_orders,attributed_revenue:j.attributed_revenue})})"
echo; echo 'E2E DONE'
