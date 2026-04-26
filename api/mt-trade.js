// api/mt-trade.js — v4 fix resultado
const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;

function session(t) {
  try {
    const h = new Date(t).getUTCHours();
    return h < 9 ? 'Asia' : h < 13 ? 'Londres' : h < 18 ? 'Nueva York' : 'Tarde';
  } catch(e) { return ''; }
}

// Normalize MT direction → BUY/SELL
function normalizeDir(type) {
  const t = (type || '').toString().toLowerCase().trim();
  if (t === 'buy' || t === '0' || t === 'long') return 'BUY';
  if (t === 'sell' || t === '1' || t === 'short') return 'SELL';
  return (type || '').toString().toUpperCase();
}

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    const r1 = await fetch(`${SURL}/rest/v1/api_keys?token=eq.${encodeURIComponent(token)}&select=user_id`, {
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` }
    });
    const keys = await r1.json();
    if (!keys || !keys.length) return res.status(401).json({ error: 'Token invalido' });
    const userId = keys[0].user_id;

    const b = req.body;
    if (!b || !b.ticket) return res.status(400).json({ error: 'ticket requerido' });

    // Calculate net resultado: profit + swap + commission
    const profit     = parseFloat(b.profit)     || 0;
    const swap       = parseFloat(b.swap)       || 0;
    const commission = parseFloat(b.commission) || 0;
    const resultado  = parseFloat((profit + swap + commission).toFixed(2));

    const direccion  = normalizeDir(b.type);
    const instrumento = (b.symbol || '').toString().toUpperCase();

    // Check if trade exists (open position synced before)
    const r2 = await fetch(`${SURL}/rest/v1/operaciones?mt_ticket=eq.${b.ticket}&user_id=eq.${userId}&select=id`, {
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` }
    });
    const existing = await r2.json();

    if (existing && existing.length) {
      // Update existing open → closed
      await fetch(`${SURL}/rest/v1/operaciones?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          estado: 'Finalizada',
          resultado,
          fecha_cierre: b.close_time || new Date().toISOString()
        })
      });
      console.log('Updated closed trade:', b.ticket, 'resultado:', resultado);
    } else {
      // Insert directly as closed
      const r4 = await fetch(`${SURL}/rest/v1/operaciones`, {
        method: 'POST',
        headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          mt_ticket: String(b.ticket),
          instrumento,
          direccion,
          contratos: parseFloat(b.volume) || 0,
          entrada: parseFloat(b.open_price) || 0,
          resultado,
          fecha: b.open_time || new Date().toISOString(),
          fecha_cierre: b.close_time || new Date().toISOString(),
          sesion: session(b.open_time),
          estado: 'Finalizada',
          notas: b.comment || ''
        })
      });
      const txt = await r4.text();
      console.log('Inserted closed trade:', b.ticket, 'resultado:', resultado, 'status:', r4.status);
      if (r4.status >= 400) return res.status(500).json({ error: 'Error inserting trade', detail: txt });
    }

    return res.status(200).json({ ok: true, resultado });
  } catch(e) {
    console.error('mt-trade error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
