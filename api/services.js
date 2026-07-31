// Vercel serverless function — deploy at /api/services.js
// Combines what were 3 separate files into one, since they all just read/write
// the same services list. Routes by method + a "mode" field.
//
// PUBLIC:
//   GET  /api/services                          → approved listings only
//   POST /api/services  {mode:'submit', ...}     → submit a new listing (pending)
//
// ADMIN (needs ADMIN_KEY):
//   GET  /api/services?admin=1&key=YOUR_KEY      → pending listings
//   POST /api/services  {mode:'moderate', key, id, action:'approve'|'reject'}
//
// SETUP: same as before —
//   npm install @vercel/blob
//   Enable Blob storage: Vercel → Storage → Create → Blob
//   Add env var: ADMIN_KEY = any long random string you choose

import { put, head } from '@vercel/blob';

const SERVICES_FILE = 'services/services.json';

async function readServices() {
  try {
    const info = await head(SERVICES_FILE);
    const res = await fetch(info.url);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function writeServices(list) {
  await put(SERVICES_FILE, JSON.stringify(list, null, 2), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  });
}

function isValidPhone(phone) {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  return digits.length >= 10;
}

function checkAdminKey(providedKey) {
  const realKey = process.env.ADMIN_KEY;
  return realKey && providedKey && providedKey === realKey;
}

export default async function handler(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Server not configured — Blob storage not enabled yet' });
  }

  // ---- GET: public approved list, or admin pending list ----
  if (req.method === 'GET') {
    if (req.query.admin === '1') {
      if (!checkAdminKey(req.query.key)) return res.status(401).json({ error: 'Unauthorized' });
      const list = await readServices();
      return res.status(200).json({ pending: list.filter(s => s.status === 'pending') });
    }
    const list = await readServices();
    const approved = list
      .filter(s => s.status === 'approved')
      .map(({ id, businessName, category, description, phone, city, lang }) =>
        ({ id, businessName, category, description, phone, city, lang }));
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ services: approved });
  }

  // ---- POST: public submission, or admin moderation ----
  if (req.method === 'POST') {
    const body = req.body || {};

    if (body.mode === 'moderate') {
      if (!checkAdminKey(body.key)) return res.status(401).json({ error: 'Unauthorized' });
      if (!body.id || !['approve', 'reject'].includes(body.action)) {
        return res.status(400).json({ error: 'id and action ("approve"|"reject") are required' });
      }
      const list = await readServices();
      const entry = list.find(s => s.id === body.id);
      if (!entry) return res.status(404).json({ error: 'Listing not found' });
      entry.status = body.action === 'approve' ? 'approved' : 'rejected';
      entry.reviewedAt = new Date().toISOString();
      await writeServices(list);
      return res.status(200).json({ ok: true, id: body.id, status: entry.status });
    }

    // default: submission
    const { businessName, category, description, phone, city, lang } = body;
    if (!businessName || businessName.trim().length < 2) {
      return res.status(400).json({ error: 'businessName is required' });
    }
    if (!category || category.trim().length < 2) {
      return res.status(400).json({ error: 'category is required' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'a valid phone number is required' });
    }
    if (description && description.length > 600) {
      return res.status(400).json({ error: 'description too long (max 600 characters)' });
    }

    const list = await readServices();
    const entry = {
      id: `svc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      businessName: businessName.trim().slice(0, 80),
      category: category.trim().slice(0, 40),
      description: (description || '').trim().slice(0, 600),
      phone: phone.trim().slice(0, 20),
      city: (city || '').trim().slice(0, 60),
      lang: lang === 'hi' ? 'hi' : 'en',
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    list.push(entry);
    await writeServices(list);
    return res.status(200).json({ ok: true, id: entry.id, status: 'pending' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
