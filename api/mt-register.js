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
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  console.log('sbQuery', method, path.split('?')[0], 'status:', res.status, 'body:', text.slice(0,200));
  try { return { data: JSON.parse(text), status: res.status }; }
  catch(e) { return { data: text, status: res.status }; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  // Buscar usuario por token
  const { data: keys, status: s1 } = await sbQuery(
    'api_keys?token=eq.' + encodeURIComponent(token) + '&activo=eq.true&select=user_id',
    'GET'
  );
  if (s1 !== 200 || !keys || !keys.length) {
    return res.status(401).json({ error: 'Token invalido', debug: keys });
  }

  const userId = keys[0].user_id;
  const account = req.body;
  console.log('account body:', JSON.stringify(account));

  if (!account || !account.account_number) {
    return res.status(400).json({ error: 'Datos incompletos', body: account });
  }

  const nombre = account.alias ||
    (account.platform + ' - ' + account.broker + ' #' + account.account_number);

  // Intentar INSERT simple sin upsert primero
  const { data: insertData, status: s2 } = await sbQuery('cuentas', 'POST', {
    user_id:         userId,
    nombre:          nombre,
    broker:          account.broker || '',
    servidor:        account.server || '',
    numero_cuenta:   String(account.account_number),
    plataforma:      account.platform || 'MT5',
    divisa:          account.currency || 'USD',
    apalancamiento:  parseInt(account.leverage) || 0,
    balance_inicial: parseFloat(account.balance) || 0,
    tipo:            account.account_type || 'real',
    mt_conectada:    true,
  });

  console.log('insert cuentas status:', s2, 'data:', JSON.stringify(insertData).slice(0,300));

  // Actualizar last_used del token
  await sbQuery('api_keys?token=eq.' + encodeURIComponent(token), 'PATCH', {
    last_used: new Date().toISOString()
  });

  if (s2 >= 400) {
    return res.status(500).json({ error: 'Error guardando cuenta', detail: insertData });
  }
  return res.status(200).json({ ok: true, message: 'Cuenta registrada' });
};
