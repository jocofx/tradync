// api/mt-register.js — Sin dependencias externas, usa fetch nativo
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbQuery(path, method, body) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: method || 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { data: JSON.parse(text), status: res.status }; }
  catch(e) { return { data: text, status: res.status }; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  // Buscar usuario por token
  const { data: keys } = await sbQuery('api_keys?token=eq.' + encodeURIComponent(token) + '&activo=eq.true&select=user_id');
  if (!keys || !keys.length) return res.status(401).json({ error: 'Token invalido' });

  const userId = keys[0].user_id;
  const account = req.body;
  if (!account || !account.account_number) return res.status(400).json({ error: 'Datos incompletos' });

  const nombre = account.alias || (account.platform + ' - ' + account.broker + ' #' + account.account_number);

  const { status } = await sbQuery('cuentas', 'POST', {
    user_id: userId,
    nombre: nombre,
    broker: account.broker || '',
    servidor: account.server || '',
    numero_cuenta: String(account.account_number),
    plataforma: account.platform || 'MT5',
    divisa: account.currency || 'USD',
    apalancamiento: account.leverage || 0,
    balance_inicial: account.balance || 0,
    tipo: account.account_type || 'real',
    mt_conectada: true,
  });

  // Actualizar last_used
  await sbQuery('api_keys?token=eq.' + encodeURIComponent(token), 'PATCH', { last_used: new Date().toISOString() });

  if (status >= 400) return res.status(500).json({ error: 'Error guardando cuenta' });
  return res.status(200).json({ ok: true, message: 'Cuenta registrada' });
};
