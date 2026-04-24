// api/mt-sync.js — Sin dependencias externas
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

function detectSession(isoTime) {
  if (!isoTime) return '';
  try {
    const h = new Date(isoTime).getUTCHours();
    if (h < 9)  return 'Asia';
    if (h < 13) return 'Londres';
    if (h < 18) return 'Nueva York';
    if (h < 22) return 'Tarde';
    return 'Pre-market';
  } catch(e) { return ''; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  const { data: keys } = await sbQuery('api_keys?token=eq.' + encodeURIComponent(token) + '&activo=eq.true&select=user_id');
  if (!keys || !keys.length) return res.status(401).json({ error: 'Token invalido' });

  const userId = keys[0].user_id;
  const trade = req.body;
  if (!trade || !trade.ticket || !trade.symbol) return res.status(400).json({ error: 'Datos incompletos' });

  const { status } = await sbQuery('operaciones', 'POST', {
    user_id:     userId,
    mt_ticket:   String(trade.ticket),
    instrumento: trade.symbol,
    direccion:   trade.type || '',
    contratos:   trade.volume || 0,
    entrada:     trade.open_price || 0,
    sl:          trade.sl || null,
    tp:          trade.tp || null,
    resultado:   trade.profit || null,
    fecha:       trade.open_time || new Date().toISOString(),
    sesion:      detectSession(trade.open_time),
    estado:      'Pendiente',
    notas:       trade.comment || '',
    cuenta:      String(trade.account || ''),
    plataforma:  trade.platform || 'MT',
  });

  if (status >= 400) return res.status(500).json({ error: 'Error guardando operacion' });
  return res.status(200).json({ ok: true, action: null });
};
