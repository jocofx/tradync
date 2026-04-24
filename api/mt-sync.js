// api/mt-sync.js — Recibe posiciones ABIERTAS desde EA MT4/MT5
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
  const trade = req.body;

  if (!trade || !trade.ticket || !trade.symbol) {
    return res.status(400).json({ error: 'Datos incompletos: se requiere ticket y symbol' });
  }

  try {
    const { error } = await sb.from('operaciones').upsert({
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
    }, { onConflict: 'mt_ticket,user_id' });

    if (error) throw error;

    // Verificar limites de riesgo
    const riskAction = await checkRiskLimits(sb, userId);

    return res.status(200).json({ ok: true, action: riskAction || null });
  } catch (e) {
    console.error('mt-sync error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

function detectSession(isoTime) {
  if (!isoTime) return '';
  try {
    const hour = new Date(isoTime).getUTCHours();
    if (hour >= 0  && hour < 9)  return 'Asia';
    if (hour >= 9  && hour < 13) return 'Londres';
    if (hour >= 13 && hour < 18) return 'Nueva York';
    if (hour >= 18 && hour < 22) return 'Tarde';
    return 'Pre-market';
  } catch(e) { return ''; }
}

async function checkRiskLimits(sb, userId) {
  try {
    const { data: config } = await sb
      .from('configuracion')
      .select('valor')
      .eq('user_id', userId)
      .eq('clave', 'riskSettings')
      .single();

    if (!config || !config.valor) return null;
    const settings = JSON.parse(config.valor);
    const maxLoss = parseFloat(settings.maxLoss || 0);
    if (!maxLoss) return null;

    const today = new Date().toISOString().slice(0, 10);
    const { data: trades } = await sb
      .from('operaciones')
      .select('resultado')
      .eq('user_id', userId)
      .gte('fecha', today)
      .not('resultado', 'is', null);

    const dailyPnL = (trades || []).reduce((s, t) => s + (parseFloat(t.resultado) || 0), 0);
    if (dailyPnL <= -Math.abs(maxLoss)) return 'close_all';
    return null;
  } catch (e) { return null; }
}
