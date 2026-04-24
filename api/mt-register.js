// api/mt-register.js — v3 simple
const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    // Verificar token
    const r1 = await fetch(`${SURL}/rest/v1/api_keys?token=eq.${encodeURIComponent(token)}&select=user_id`, {
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` }
    });
    const keys = await r1.json();
    if (!keys || !keys.length) return res.status(401).json({ error: 'Token invalido' });
    const userId = keys[0].user_id;

    const b = req.body;
    const nombre = b.alias || `${b.platform||'MT'} ${b.broker||''} #${b.account_number}`;

    // Buscar si ya existe esta cuenta para este usuario
    const r2 = await fetch(`${SURL}/rest/v1/cuentas?user_id=eq.${userId}&nombre=eq.${encodeURIComponent(nombre)}&select=id`, {
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` }
    });
    const existing = await r2.json();

    if (existing && existing.length) {
      // Ya existe, actualizar balance
      await fetch(`${SURL}/rest/v1/cuentas?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ balance: parseFloat(b.balance)||0, activa: true })
      });
    } else {
      // Insertar nueva cuenta
      const r3 = await fetch(`${SURL}/rest/v1/cuentas`, {
        method: 'POST',
        headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          nombre: nombre,
          tipo: b.account_type || 'real',
          balance: parseFloat(b.balance) || 0,
          broker: b.broker || '',
          fase: b.platform || 'MT5',
          activa: true
        })
      });
      const txt = await r3.text();
      console.log('insert cuenta:', r3.status, txt.slice(0,300));
      if (r3.status >= 400) return res.status(500).json({ error: 'Error inserting cuenta', detail: txt });
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('mt-register error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
