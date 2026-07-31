// Vercel serverless function — deploy at /api/send-receipt.js
// Generates a PDF receipt after payment and emails it (always, if an email
// was given) and sends a WhatsApp notification (if configured — see notes).
//
// ---------------------------------------------------------------------------
// SETUP — you need TWO things before this works:
//
// 1) Add "pdfkit" as a dependency (PDF generation library):
//      npm install pdfkit
//    (adds it to package.json — commit that change along with this file)
//
// 2) Environment variables in Vercel → Settings → Environment Variables:
//      RESEND_API_KEY        — from resend.com (free tier is fine to start)
//      RESEND_FROM_EMAIL     — an email address verified on your Resend domain,
//                              e.g. "S Star Events <receipts@yourdomain.com>"
//      TWILIO_ACCOUNT_SID    — from twilio.com console (optional, see below)
//      TWILIO_AUTH_TOKEN     — from twilio.com console (optional, see below)
//      TWILIO_WHATSAPP_FROM  — your Twilio WhatsApp sender, e.g. "whatsapp:+14155238886"
//      TWILIO_TEMPLATE_SID   — an APPROVED WhatsApp content template SID (see below)
//      BLOB_READ_WRITE_TOKEN — auto-added if you enable Vercel Blob storage
//                              (Vercel dashboard → Storage → Create → Blob)
//
// ---------------------------------------------------------------------------
// IMPORTANT — WhatsApp is NOT optional-code-only, it needs a real approval step:
// WhatsApp Business rules mean you cannot freely message a customer just
// because they paid — you can only send a message they didn't initiate first
// if it uses a PRE-APPROVED template. In Twilio: Console → Messaging →
// Content Template Builder → create something like:
//     "Namaste {{1}}! Your S Star booking receipt for {{2}} is ready: {{3}}"
// Submit it for WhatsApp approval (usually takes a few hours to a couple of
// days). Once approved, copy its Content SID into TWILIO_TEMPLATE_SID.
// Until that's approved, this function will simply skip the WhatsApp step —
// email will still work independently.
// ---------------------------------------------------------------------------

import PDFDocument from 'pdfkit';
import { put } from '@vercel/blob';

function buildPdfBuffer({ name, phone, email, service, guestCount, date, amount, lang, bookingRef }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const isHi = lang === 'hi';
    const L = isHi
      ? {
          title: 'S Star Event Planner — भुगतान रसीद',
          ref: 'बुकिंग संदर्भ',
          date: 'तारीख़',
          name: 'नाम',
          phone: 'फ़ोन',
          email: 'ईमेल',
          service: 'सेवा',
          guests: 'मेहमानों की संख्या',
          amount: 'भुगतान राशि',
          thanks: 'आपके भरोसे के लिए धन्यवाद। हमारी टीम जल्द ही आपसे संपर्क करेगी।',
          footer: 'यह एक ऑटो-जनरेटेड रसीद है — S Star Event Planner, Balaghat, MP',
        }
      : {
          title: 'S Star Event Planner — Payment Receipt',
          ref: 'Booking Reference',
          date: 'Date',
          name: 'Name',
          phone: 'Phone',
          email: 'Email',
          service: 'Service',
          guests: 'Guest Count',
          amount: 'Amount Paid',
          thanks: 'Thank you for trusting us. Our team will reach out to you shortly.',
          footer: 'This is an auto-generated receipt — S Star Event Planner, Balaghat, MP',
        };

    doc.fontSize(20).fillColor('#8a6a2c').text(L.title, { align: 'center' });
    doc.moveDown(1.5);
    doc.fontSize(11).fillColor('#1a1206');

    const row = (label, value) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value || '—');
      doc.moveDown(0.4);
    };

    row(L.ref, bookingRef);
    row(L.date, date);
    row(L.name, name);
    row(L.phone, phone);
    row(L.email, email);
    row(L.service, service);
    row(L.guests, guestCount);
    doc.moveDown(0.4);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#8a6a2c').text(`${L.amount}: ₹${amount}`);
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#555').font('Helvetica').text(L.thanks, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#999').text(L.footer, { align: 'center' });

    doc.end();
  });
}

async function sendEmail({ to, name, pdfBuffer, lang }) {
  if (!to) return { skipped: true, reason: 'no email provided' };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { skipped: true, reason: 'RESEND_API_KEY / RESEND_FROM_EMAIL not configured' };

  const isHi = lang === 'hi';
  const subject = isHi ? 'आपकी S Star बुकिंग रसीद' : 'Your S Star Booking Receipt';
  const body = isHi
    ? `नमस्ते ${name || ''},<br><br>आपकी बुकिंग के लिए भुगतान सफलतापूर्वक प्राप्त हो गया है। कृपया संलग्न रसीद देखें।<br><br>धन्यवाद,<br>S Star Event Planner`
    : `Hi ${name || ''},<br><br>We've received your payment successfully. Please find your receipt attached.<br><br>Thank you,<br>S Star Event Planner`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: body,
      attachments: [{ filename: 'receipt.pdf', content: pdfBuffer.toString('base64') }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend error: ${errText}`);
  }
  return { sent: true };
}

async function sendWhatsApp({ toPhone, name, service, pdfUrl }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const templateSid = process.env.TWILIO_TEMPLATE_SID;
  if (!sid || !token || !from || !templateSid) {
    return { skipped: true, reason: 'Twilio WhatsApp not fully configured (needs an APPROVED template)' };
  }
  if (!toPhone) return { skipped: true, reason: 'no phone provided' };

  // Normalize to E.164-ish; assumes Indian numbers if no country code given.
  let phone = toPhone.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = phone.length === 10 ? `+91${phone}` : `+${phone}`;

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const params = new URLSearchParams({
    To: `whatsapp:${phone}`,
    From: from,
    ContentSid: templateSid,
    ContentVariables: JSON.stringify({ '1': name || 'Guest', '2': service || 'your booking', '3': pdfUrl || '' }),
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio error: ${errText}`);
  }
  return { sent: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, email, service, guestCount, date, amount, lang } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const bookingRef = `SS-${Date.now().toString(36).toUpperCase()}`;

  try {
    const pdfBuffer = await buildPdfBuffer({
      name, phone, email, service, guestCount, date,
      amount: amount || '499.00', lang, bookingRef,
    });

    // Upload PDF to Vercel Blob so WhatsApp (which needs a public media URL,
    // not raw file bytes) has something to link to. Safe to skip silently if
    // Blob storage isn't set up — email will still carry the PDF as an attachment.
    let pdfUrl = null;
    try {
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const blob = await put(`receipts/${bookingRef}.pdf`, pdfBuffer, {
          access: 'public',
          contentType: 'application/pdf',
        });
        pdfUrl = blob.url;
      }
    } catch (e) { /* non-fatal — WhatsApp step will just report skipped */ }

    const [emailResult, whatsappResult] = await Promise.allSettled([
      sendEmail({ to: email, name, pdfBuffer, lang }),
      sendWhatsApp({ toPhone: phone, name, service, pdfUrl }),
    ]);

    return res.status(200).json({
      bookingRef,
      email: emailResult.status === 'fulfilled' ? emailResult.value : { error: emailResult.reason?.message },
      whatsapp: whatsappResult.status === 'fulfilled' ? whatsappResult.value : { error: whatsappResult.reason?.message },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Receipt generation failed' });
  }
}
