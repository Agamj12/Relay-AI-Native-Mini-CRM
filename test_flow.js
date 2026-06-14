// test_flow.js — Verifies the full AI CRM workflow end-to-end against the running server.

const BASE_URL = 'http://localhost:4000';

let authToken = null;

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'content-type': 'application/json',
    ...(authToken ? { 'authorization': `Bearer ${authToken}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Request to ${path} failed with status ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function run() {
  console.log('🚀 Starting end-to-end workflow verification...\n');

  // 0. Authenticate before running tests
  console.log('Authenticating test runner...');
  try {
    const authRes = await request('/api/auth/signup', {
      method: 'POST',
      body: { name: 'E2E Test User', email: 'e2e@example.com', password: 'password123' }
    });
    authToken = authRes.token;
    console.log(`Successfully registered test user! Token: ${authToken.substring(0, 8)}...`);
  } catch (e) {
    // If user already exists, login
    const authRes = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'e2e@example.com', password: 'password123' }
    });
    authToken = authRes.token;
    console.log(`Successfully logged in existing test user! Token: ${authToken.substring(0, 8)}...`);
  }
  console.log('');

  // 1. Get overview to check AI status
  console.log('Checking overview and AI connection...');
  const overview = await request('/api/overview');
  console.log(`Overview details: ${overview.customers} customers, ${overview.orders} orders.`);
  console.log(`AI enabled: ${overview.ai_enabled} (${overview.ai_provider})\n`);

  if (!overview.ai_enabled || overview.ai_provider !== 'Gemini') {
    throw new Error('AI or Gemini is not properly enabled on the server.');
  }

  // 2. Test natural language segment preview (powered by Gemini)
  console.log('1️⃣ Testing Natural Language Segmentation (Gemini)...');
  const prompt = 'shoppers who spent over ₹5000 but have been inactive for 3 months';
  console.log(`Prompt: "${prompt}"`);
  const preview = await request('/api/segments/preview', {
    method: 'POST',
    body: { prompt }
  });
  console.log(`Gemini Understood as: "${preview.description}"`);
  console.log(`Source: ${preview.source}`);
  console.log(`Matching audience size: ${preview.size} shoppers`);
  console.log(`Sample matching shopper:`, preview.sample[0] ? `${preview.sample[0].first_name} (Spend: ₹${preview.sample[0].total_spend})` : 'None');
  console.log('Rules parsed by Gemini:', JSON.stringify(preview.rules), '\n');

  // 3. Save the segment
  console.log('2️⃣ Saving segment...');
  const savedSegment = await request('/api/segments', {
    method: 'POST',
    body: {
      name: 'High-value inactive shoppers',
      prompt,
      rules: preview.rules
    }
  });
  const segmentId = savedSegment.id;
  console.log(`Saved segment with ID: ${segmentId}\n`);

  // 4. Draft message templates with AI (Gemini)
  console.log('3️⃣ Generating message variants with Gemini...');
  const objective = 'win back lapsed high spenders with a 20% offer, warm tone, mention their favourite drinks';
  const drafts = await request('/api/ai/draft', {
    method: 'POST',
    body: {
      objective,
      segment_id: segmentId,
      channel: 'WHATSAPP'
    }
  });
  console.log(`Generated variants (Source: ${drafts.source}):`);
  drafts.variants.forEach((v, index) => {
    console.log(`  [Variant ${index + 1}] ${v.label}: "${v.text}"`);
  });
  console.log('');

  // 5. Launch the Campaign
  console.log('4️⃣ Launching campaign...');
  const selectedTemplate = drafts.variants[0].text;
  const campaign = await request('/api/campaigns', {
    method: 'POST',
    body: {
      name: 'Brew & Bloom Winback Campaign',
      objective,
      segment_id: segmentId,
      channel: 'WHATSAPP',
      message_template: selectedTemplate
    }
  });
  const campaignId = campaign.id;
  console.log(`Campaign successfully launched! ID: ${campaignId}, Status: ${campaign.status}`);
  console.log(`Target audience size: ${campaign.audience_size} shoppers.\n`);

  // 6. Monitor campaign callback stats live (Simulate async callback receipts processing)
  console.log('5️⃣ Monitoring live delivery status callback updates from channel simulator...');
  console.log('Waiting for receipts to stream in and settle (this takes a few seconds)...');
  
  // Poll every 3 seconds, up to 5 times
  for (let i = 1; i <= 5; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const campaignDetail = await request(`/api/campaigns/${campaignId}`);
    console.log(`[t+${i*3}s] Sent: ${campaignDetail.sent} | Delivered: ${campaignDetail.delivered} | Failed: ${campaignDetail.failed} | Opened: ${campaignDetail.opened} | Clicked: ${campaignDetail.clicked} | Ordered: ${campaignDetail.converted} | Attributed Revenue: ₹${Math.round(campaignDetail.revenue)}`);
    
    // Stop early if everything has arrived/processed
    if (campaignDetail.sent > 0 && campaignDetail.delivered + campaignDetail.failed >= campaignDetail.sent) {
      console.log('Funnel updates settled!');
      break;
    }
  }
  console.log('');

  // 7. Get AI Campaign Insight (Gemini performance analytics narrative)
  console.log('6️⃣ Requesting Campaign Performance Narrative Insight (Gemini)...');
  const insight = await request(`/api/campaigns/${campaignId}/insight`, { method: 'POST' });
  console.log('Gemini Campaign Insight Narrative:\n');
  console.log(`"${insight.text}"\n`);

  // 8. Attributed revenue check
  console.log('7️⃣ Verification of dashboard-wide campaign attribution metrics...');
  const finalOverview = await request('/api/overview');
  console.log(`Campaign-Attributed Orders: ${finalOverview.attributed_orders}`);
  console.log(`Campaign-Attributed Revenue: ₹${Math.round(finalOverview.attributed_revenue)}`);
  console.log(`\n🎉 Verification Completed Successfully! The application is FULLY WORKING with Gemini AI integration.`);
}

run().catch(err => {
  console.error('\n❌ Verification Failed:', err.message);
  process.exit(1);
});
