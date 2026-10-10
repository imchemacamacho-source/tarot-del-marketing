// This URL belongs only in Vercel's server-side environment variables.
const { randomUUID } = require('node:crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const configuredUrl = (process.env.LEADS_WEBHOOK_URL || '').trim();
  if (!configuredUrl) {
    return res.status(503).json({ error: 'Lead storage not configured', code: 'WEBHOOK_MISSING' });
  }
  let webhook;
  try {
    webhook = new URL(configuredUrl);
    if (webhook.protocol !== 'https:' || webhook.hostname !== 'script.google.com' ||
        !/^\/(?:macros|a\/macros\/[^/]+)\/s\/[^/]+\/exec$/.test(webhook.pathname) ||
        webhook.username || webhook.password || webhook.hash) throw new Error('Invalid webhook');
  } catch (_) {
    return res.status(503).json({ error: 'Lead storage not configured', code: 'WEBHOOK_INVALID_URL' });
  }

  const { name, phone, topic, marketingConsent, registrationId = randomUUID() } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100 ||
      typeof phone !== 'string' || !/^[+0-9() .-]{8,22}$/.test(phone.trim()) ||
      phone.replace(/\D/g, '').length < 8 ||
      typeof topic !== 'string' || !topic.trim() || topic.length > 120 ||
      typeof marketingConsent !== 'boolean' ||
      typeof registrationId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(registrationId)) {
    return res.status(400).json({ error: 'Invalid data', code: 'INVALID_DATA' });
  }

  try {
    const response = await fetch(webhook.href, {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(), phone: phone.trim(), topic: topic.trim(), marketingConsent,
        registrationId, consentVersion: '2026-10-10',
        createdAt: new Date().toISOString(), source: 'tarot-del-marketing'
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      return res.status(502).json({ error: 'Storage unavailable', code: 'WEBHOOK_HTTP_ERROR' });
    }
    // Apps Script can return HTTP 200 for an HTML error or a failed doPost.
    let receipt;
    try { receipt = JSON.parse(await response.text()); }
    catch (_) {
      return res.status(502).json({ error: 'Storage unavailable', code: 'WEBHOOK_NOT_JSON' });
    }
    if (!receipt || receipt.ok !== true || receipt.stored !== true ||
        !Number.isInteger(receipt.row) || receipt.row < 2 ||
        receipt.sheet !== 'Registros' || receipt.registrationId !== registrationId) {
      return res.status(502).json({ error: 'Storage unavailable', code: 'WEBHOOK_SAVE_NOT_CONFIRMED' });
    }
    return res.status(200).json({ ok: true, stored: true, registrationId, row: receipt.row });
  } catch (error) {
    return res.status(502).json({
      error: 'Storage unavailable',
      code: error.name === 'TimeoutError' || error.name === 'AbortError' ? 'WEBHOOK_TIMEOUT' : 'WEBHOOK_NETWORK_ERROR'
    });
  }
};
