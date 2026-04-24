// api/mt-register.js — Registra cuenta MT en Supabase
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  let sb;
  try {
    sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  } catch(e) {
    return res.status(500).json({ error: 'Supabase init error: ' + e.message });
  }

  // Buscar usuario por token
  const { data: apiKey, error: tokenError } = await sb
    .from('api_keys')
    .select('user_id')
    .eq('token', token)
    .eq('activo', true)
    .single();

  if (tokenError || !apiKey) {
    return res.status(401).json({ error: 'Token invalido' });
  }

  const userId = apiKey.user_id;
  const account = req.body;

  if (!account || !account.account_number) {
    return res.status(400).json({ error: 'Datos de cuenta incompletos' });
  }

  try {
    const nombre = account.alias ||
      (account.platform + ' - ' + account.broker + ' #' + account.account_number);

    const { error } = await sb.from('cuentas').upsert({
      user_id:         userId,
      nombre:          nombre,
      broker:          account.broker || '',
      servidor:        account.server || '',
      numero_cuenta:   String(account.account_number),
      plataforma:      account.platform || 'MT5',
      divisa:          account.currency || 'USD',
      apalancamiento:  account.leverage || 0,
      balance_inicial: account.balance || 0,
      tipo:            account.account_type || 'real',
      mt_conectada:    true,
    }, { onConflict: 'numero_cuenta,user_id' });

    if (error) throw error;

    // Actualizar last_used del token
    await sb.from('api_keys')
      .update({ last_used: new Date().toISOString() })
      .eq('token', token);

    return res.status(200).json({ ok: true, message: 'Cuenta registrada correctamente' });
  } catch (e) {
    console.error('mt-register error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
