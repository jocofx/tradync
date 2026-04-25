// api/mt-register.js — v4 con risk_config y score
const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  const r1 = await fetch(
    `${SURL}/rest/v1/api_keys?token=eq.${encodeURIComponent(token)}&activo=eq.true&select=user_id`,
    { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } }
  );
  const keys = await r1.json();
  if (!keys || !keys.length) return res.status(401).json({ error: 'Token invalido' });

  const userId = keys[0].user_id;
  const b = req.body;
  if (!b || !b.account_number) return res.status(400).json({ error: 'Datos incompletos' });

  const nombre = b.alias || `${b.platform||'MT'} - ${b.broker||''} #${b.account_number}`;

  // Check if exists
  const r2 = await fetch(
    `${SURL}/rest/v1/cuentas?user_id=eq.${userId}&numero_cuenta=eq.${b.account_number}&select=id`,
    { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } }
  );
  const existing = await r2.json();

  const data = {
    user_id:         userId,
    nombre:          nombre,
    tipo:            b.account_type || 'real',
    balance:         parseFloat(b.balance) || 0,
    broker:          b.broker || '',
    fase:            b.platform || 'MT5',
    activa:          true,
    numero_cuenta:   String(b.account_number),
    plataforma:      b.platform || 'MT5',
    mt_conectada:    true,
    ea_score:        parseFloat(b.score) || 0,
    ea_perfil:       b.perfil || 'Disciplinado',
    ea_disciplina:   parseInt(b.disciplina) || 100,
    ea_risk_config:  b.risk_config ? JSON.stringify(b.risk_config) : null,
    ea_last_update:  new Date().toISOString()
  };

  if (existing && existing.length) {
    await fetch(
      `${SURL}/rest/v1/cuentas?id=eq.${existing[0].id}`,
      {
        method: 'PATCH',
        headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(data)
      }
    );
  } else {
    const r3 = await fetch(`${SURL}/rest/v1/cuentas`, {
      method: 'POST',
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(data)
    });
    const txt = await r3.text();
    if (r3.status >= 400) return res.status(500).json({ error: txt });
  }

  return res.status(200).json({ ok: true });
};
