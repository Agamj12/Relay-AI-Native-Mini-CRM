// index.js — CRM service entrypoint (port 4000).
// Serves the JSON API under /api and, in production, the built web app.

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { connectDB } from './db.js';
import { seedIfEmpty } from './seed.js';
import { aiEnabled } from './services/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api', api);
app.get('/health', (_req, res) => res.json({ ok: true, service: 'relay-crm' }));

// Serve the built frontend if it exists (single-deploy mode).
const dist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

connectDB()
  .then(async () => {
    const seeded = await seedIfEmpty();
    app.listen(PORT, () => {
      console.log(`[relay-crm] listening on :${PORT}  (seed: ${seeded.seeded ? 'created ' + seeded.customers + ' customers' : seeded.customers + ' customers present'})`);
      const aiState = aiEnabled()
        ? (process.env.GEMINI_API_KEY ? 'Gemini enabled' : 'Claude enabled')
        : 'no API key — using deterministic fallbacks';
      console.log(`[relay-crm] AI: ${aiState}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database connection:', err.message);
    process.exit(1);
  });
