// api/mt-sync.js — v3 simple
const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;

function session(t) {
  try { const h = new Date(t).getUTCHours(); return h<9?'Asia':h<13?'Londres':h<18?'Nueva York':'Tarde'; }
  catch(e) { return ''; }
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

    // Verificar si ya existe
    const r2 = await fetch(`${SURL}/rest/v1/operaciones?mt_ticket=eq.${b.ticket}&user_id=eq.${userId}&select=id`, {
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` }
    });
    const existing = await r2.json();

    if (existing && existing.length) {
      // Actualizar sl/tp/profit
      await fetch(`${SURL}/rest/v1/operaciones?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ sl: b.sl||null, tp: b.tp||null, resultado: b.profit||null })
      });
    } else {
      // Nueva operacion abierta
      const r3 = await fetch(`${SURL}/rest/v1/operaciones`, {
        method: 'POST',
        headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          mt_ticket: String(b.ticket),
          instrumento: b.symbol,
          direccion: b.type||'',
          contratos: b.volume||0,
          entrada: b.open_price||0,
          sl: b.sl||null,
          tp: b.tp||null,
          resultado: b.profit||null,
          fecha: b.open_time||new Date().toISOString(),
          sesion: session(b.open_time),
          estado: 'Pendiente',
          notas: b.comment||''
        })
      });
      const txt = await r3.text();
      console.log('insert op:', r3.status, txt.slice(0,300));
      if (r3.status >= 400) return res.status(500).json({ error: 'Error inserting op', detail: txt });
    }
    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('mt-sync error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
