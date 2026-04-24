// api/mt-trade.js — Recibe operaciones CERRADAS desde EA
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
  const trade = req.body;

  if (!trade.ticket || !trade.symbol) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    const resultado = parseFloat(trade.profit || 0) +
                      parseFloat(trade.swap || 0) +
                      parseFloat(trade.commission || 0);

    const { error } = await sb.from('operaciones').upsert({
      user_id:      userId,
      mt_ticket:    String(trade.ticket),
      instrumento:  trade.symbol,
      direccion:    trade.type,
      contratos:    trade.volume,
      entrada:      trade.open_price,
      sl:           trade.sl || null,
      tp:           trade.tp || null,
      resultado:    resultado,
      fecha:        trade.open_time,
      fecha_cierre: trade.close_time,
      sesion:       detectSession(trade.open_time),
      estado:       'Finalizada',
      notas:        trade.comment || '',
      cuenta:       String(trade.account),
      plataforma:   trade.platform || 'MT',
    }, { onConflict: 'mt_ticket,user_id' });

    if (error) throw error;

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('mt-trade error:', e);
    return res.status(500).json({ error: e.message });
  }
}

function detectSession(isoTime) {
  if (!isoTime) return '';
  const hour = new Date(isoTime).getUTCHours();
  if (hour >= 0  && hour < 9)  return 'Asia';
  if (hour >= 9  && hour < 13) return 'Londres';
  if (hour >= 13 && hour < 18) return 'Nueva York';
  if (hour >= 18 && hour < 22) return 'Tarde';
  return 'Pre-market';
}
