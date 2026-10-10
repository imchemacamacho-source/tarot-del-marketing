// Configure LEADS_WEBHOOK_URL in Vercel Environment Variables. Never store secrets in the frontend.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const url = process.env.LEADS_WEBHOOK_URL;
  if (!url) return res.status(503).json({error:'Lead storage not configured'});
  const {name,phone,topic,marketingConsent} = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 100 || typeof phone !== 'string' || !/^[+0-9() .-]{8,22}$/.test(phone) || typeof topic !== 'string' || topic.length > 120 || typeof marketingConsent !== 'boolean') return res.status(400).json({error:'Invalid data'});
  try {
    const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim(),phone:phone.trim(),topic,marketingConsent,consentVersion:'2026-10-10',createdAt:new Date().toISOString(),source:'tarot-del-marketing'}),signal:AbortSignal.timeout(8000)});
    if (!response.ok) return res.status(502).json({error:'Storage unavailable'});
    return res.status(200).json({ok:true});
  } catch (_) {return res.status(502).json({error:'Storage unavailable'});}
};
