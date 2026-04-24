// api/mt-register.js — Registra/actualiza cuenta de MT en Supabase
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  const { data: apiKey, error: tokenError } = await sb
    .from('api_keys')
    .select('user_id')
    .eq('token', token)
    .single();

  if (tokenError || !apiKey) return res.status(401).json({ error: 'Token invalido' });

  const userId = apiKey.user_id;
  const account = req.body;

  try {
    const nombre = account.alias ||
      `${account.platform} - ${account.broker} #${account.account_number}`;

    const { error } = await sb.from('cuentas').upsert({
      user_id:        userId,
      nombre:         nombre,
      broker:         account.broker,
      servidor:       account.server,
      numero_cuenta:  String(account.account_number),
      plataforma:     account.platform,
      divisa:         account.currency,
      apalancamiento: account.leverage,
      balance_inicial:account.balance,
      tipo:           account.account_type,
      activa:         true,
      mt_conectada:   true,
    }, { onConflict: 'numero_cuenta,user_id' });

    if (error) throw error;

    return res.status(200).json({ ok: true, message: 'Cuenta registrada' });

  } catch (e) {
    console.error('mt-register error:', e);
    return res.status(500).json({ error: e.message });
  }
}
