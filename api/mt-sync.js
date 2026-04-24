// api/mt-sync.js — Recibe operaciones abiertas/modificadas desde EA
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verificar token
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  // Buscar usuario por token
  const { data: apiKey, error: tokenError } = await sb
    .from('api_keys')
    .select('user_id')
    .eq('token', token)
    .single();

  if (tokenError || !apiKey) return res.status(401).json({ error: 'Token invalido' });

  const userId = apiKey.user_id;
  const trade = req.body;

  // Verificar datos minimos
  if (!trade.ticket || !trade.symbol) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    // Upsert — insertar o actualizar si ya existe el ticket
    const { error } = await sb.from('operaciones').upsert({
      user_id:     userId,
      mt_ticket:   String(trade.ticket),
      instrumento: trade.symbol,
      direccion:   trade.type,
      contratos:   trade.volume,
      entrada:     trade.open_price,
      sl:          trade.sl || null,
      tp:          trade.tp || null,
      resultado:   trade.profit || null,
      fecha:       trade.open_time,
      sesion:      detectSession(trade.open_time),
      estado:      'Pendiente',
      notas:       trade.comment || '',
      cuenta:      String(trade.account),
      plataforma:  trade.platform || 'MT',
    }, { onConflict: 'mt_ticket,user_id' });

    if (error) throw error;

    // Verificar alertas de riesgo
    const riskAction = await checkRiskLimits(userId);

    return res.status(200).json({
      ok: true,
      action: riskAction  // 'close_all' si supera limites
    });

  } catch (e) {
    console.error('mt-sync error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// Detectar sesion segun hora UTC
function detectSession(isoTime) {
  if (!isoTime) return '';
  const hour = new Date(isoTime).getUTCHours();
  if (hour >= 0  && hour < 9)  return 'Asia';
  if (hour >= 9  && hour < 13) return 'Londres';
  if (hour >= 13 && hour < 18) return 'Nueva York';
  if (hour >= 18 && hour < 22) return 'Tarde';
  return 'Pre-market';
}

// Verificar si el usuario ha superado sus limites de riesgo
async function checkRiskLimits(userId) {
  try {
    const { data: config } = await sb
      .from('configuracion')
      .select('valor')
      .eq('user_id', userId)
      .eq('clave', 'riskSettings')
      .single();

    if (!config) return null;
    const settings = JSON.parse(config.valor);
    const maxLoss = parseFloat(settings.maxLoss || 0);
    if (!maxLoss) return null;

    // Calcular P&L del dia
    const today = new Date().toISOString().slice(0, 10);
    const { data: trades } = await sb
      .from('operaciones')
      .select('resultado')
      .eq('user_id', userId)
      .gte('fecha', today)
      .not('resultado', 'is', null);

    const dailyPnL = (trades || []).reduce((s, t) => s + (t.resultado || 0), 0);

    if (dailyPnL <= -Math.abs(maxLoss)) {
      return 'close_all';
    }
    return null;
  } catch (e) {
    return null;
  }
}
