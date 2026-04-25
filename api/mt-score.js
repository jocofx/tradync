// api/mt-score.js — Recibe score conductual del EA
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

  try {
    // Update cuenta with score data
    const r2 = await fetch(
      `${SURL}/rest/v1/cuentas?user_id=eq.${userId}&numero_cuenta=eq.${b.account}`,
      { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } }
    );
    const cuentas = await r2.json();

    if (cuentas && cuentas.length) {
      await fetch(
        `${SURL}/rest/v1/cuentas?id=eq.${cuentas[0].id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SKEY,
            Authorization: `Bearer ${SKEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            ea_score:          parseFloat(b.score) || 0,
            ea_perfil:         b.perfil || 'Disciplinado',
            ea_disciplina:     parseInt(b.disciplina) || 100,
            ea_violaciones:    parseInt(b.violaciones_hoy) || 0,
            ea_balance:        parseFloat(b.balance) || 0,
            ea_equity:         parseFloat(b.equity) || 0,
            ea_pnl_dia:        parseFloat(b.pnl_dia) || 0,
            ea_last_update:    new Date().toISOString()
          })
        }
      );
    }

    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('mt-score error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
