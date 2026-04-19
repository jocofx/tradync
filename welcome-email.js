// api/welcome-email.js — Vercel Serverless Function
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const userName = name || email.split('@')[0];

  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bienvenido a Tradync</title>
</head>
<body style="margin:0;padding:0;background:#05060a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#05060a;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- HEADER -->
        <tr><td style="background:#0a0c12;border:1px solid rgba(255,255,255,0.07);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
          <div style="font-size:28px;font-weight:800;letter-spacing:-1px;color:#ffffff;">
            Tradync<span style="color:#00d4a0;">App</span>
          </div>
          <div style="font-size:11px;color:#3a4060;letter-spacing:3px;margin-top:4px;font-family:monospace;">TRADING JOURNAL</div>
        </td></tr>

        <!-- HERO -->
        <tr><td style="background:#0a0c12;border-left:1px solid rgba(255,255,255,0.07);border-right:1px solid rgba(255,255,255,0.07);padding:40px 40px 32px;text-align:center;">
          <div style="width:64px;height:64px;background:rgba(0,212,160,0.12);border:1px solid rgba(0,212,160,0.3);border-radius:16px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:28px;line-height:64px;">🎯</div>
          <h1 style="color:#eef0f8;font-size:24px;font-weight:800;letter-spacing:-0.5px;margin:0 0 12px;">Bienvenido, ${userName}</h1>
          <p style="color:#7880a0;font-size:15px;line-height:1.6;margin:0;">Tu cuenta de Tradync está lista.<br>Empieza a registrar tus operaciones y mejora tu trading.</p>
        </td></tr>

        <!-- DIVIDER -->
        <tr><td style="background:linear-gradient(90deg,transparent,#00d4a0,transparent);height:1px;border-left:1px solid rgba(255,255,255,0.07);border-right:1px solid rgba(255,255,255,0.07);"></td></tr>

        <!-- STEPS -->
        <tr><td style="background:#0a0c12;border-left:1px solid rgba(255,255,255,0.07);border-right:1px solid rgba(255,255,255,0.07);padding:32px 40px;">
          <p style="color:#3a4060;font-size:10px;letter-spacing:2px;font-family:monospace;margin:0 0 20px;">PRIMEROS PASOS</p>

          <!-- Step 1 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr>
              <td width="44" valign="top">
                <div style="width:36px;height:36px;background:rgba(0,212,160,0.12);border:1px solid rgba(0,212,160,0.25);border-radius:10px;text-align:center;line-height:36px;font-size:16px;">📊</div>
              </td>
              <td style="padding-left:14px;">
                <div style="color:#eef0f8;font-size:14px;font-weight:600;margin-bottom:3px;">Registra tu primera operación</div>
                <div style="color:#7880a0;font-size:12px;line-height:1.5;">Ve a "Nueva Operación" e introduce el instrumento, dirección y resultado. Cada operación registrada es un paso hacia la mejora.</div>
              </td>
            </tr>
          </table>

          <!-- Step 2 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr>
              <td width="44" valign="top">
                <div style="width:36px;height:36px;background:rgba(77,159,255,0.12);border:1px solid rgba(77,159,255,0.25);border-radius:10px;text-align:center;line-height:36px;font-size:16px;">🛡️</div>
              </td>
              <td style="padding-left:14px;">
                <div style="color:#eef0f8;font-size:14px;font-weight:600;margin-bottom:3px;">Configura tu control de riesgo</div>
                <div style="color:#7880a0;font-size:12px;line-height:1.5;">Establece tu pérdida máxima diaria y el máximo de operaciones. El sistema te avisará cuando estés en zona de peligro.</div>
              </td>
            </tr>
          </table>

          <!-- Step 3 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr>
              <td width="44" valign="top">
                <div style="width:36px;height:36px;background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.25);border-radius:10px;text-align:center;line-height:36px;font-size:16px;">💪</div>
              </td>
              <td style="padding-left:14px;">
                <div style="color:#eef0f8;font-size:14px;font-weight:600;margin-bottom:3px;">Activa el tracker de hábitos</div>
                <div style="color:#7880a0;font-size:12px;line-height:1.5;">El trading profesional empieza fuera del mercado. Registra tu sueño, ejercicio y meditación para correlacionarlos con tus resultados.</div>
              </td>
            </tr>
          </table>

          <!-- Step 4 -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="44" valign="top">
                <div style="width:36px;height:36px;background:rgba(245,166,35,0.12);border:1px solid rgba(245,166,35,0.25);border-radius:10px;text-align:center;line-height:36px;font-size:16px;">🤖</div>
              </td>
              <td style="padding-left:14px;">
                <div style="color:#eef0f8;font-size:14px;font-weight:600;margin-bottom:3px;">Mejora con tu Coach IA <span style="background:rgba(0,212,160,0.15);color:#00d4a0;font-size:10px;padding:2px 8px;border-radius:10px;font-family:monospace;letter-spacing:1px;">PRO</span></div>
                <div style="color:#7880a0;font-size:12px;line-height:1.5;">Con el plan Pro tienes acceso al Coach IA que analiza tus operaciones reales y te da consejos personalizados cada semana.</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="background:#0a0c12;border-left:1px solid rgba(255,255,255,0.07);border-right:1px solid rgba(255,255,255,0.07);padding:0 40px 32px;text-align:center;">
          <a href="https://www.tradyncapp.com/tradync-app.html" style="display:inline-block;background:linear-gradient(135deg,#00d4a0,#4d9fff);color:#0d1117;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;">Ir a mi journal →</a>
        </td></tr>

        <!-- PRO BANNER -->
        <tr><td style="background:rgba(0,212,160,0.06);border:1px solid rgba(0,212,160,0.2);border-radius:10px;margin:0 40px;padding:20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="color:#00d4a0;font-size:13px;font-weight:700;margin-bottom:4px;">⭐ 14 días de Pro gratis</div>
                <div style="color:#7880a0;font-size:12px;line-height:1.5;">Prueba todas las funciones premium sin coste. Coach IA, estadísticas avanzadas, exportar CSV y más. Sin tarjeta de crédito.</div>
              </td>
              <td width="100" align="right">
                <a href="https://www.tradyncapp.com/tradync-app.html" style="display:inline-block;border:1px solid rgba(0,212,160,0.4);color:#00d4a0;font-size:12px;font-weight:600;padding:8px 16px;border-radius:8px;text-decoration:none;white-space:nowrap;">Ver planes</a>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#05060a;border:1px solid rgba(255,255,255,0.07);border-top:none;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
          <p style="color:#3a4060;font-size:11px;font-family:monospace;margin:0 0 8px;">tradyncapp.com · Tu journal de trading profesional</p>
          <p style="color:#3a4060;font-size:11px;margin:0;">
            <a href="https://www.tradyncapp.com/privacidad.html" style="color:#3a4060;text-decoration:none;">Privacidad</a> ·
            <a href="https://www.tradyncapp.com/terminos.html" style="color:#3a4060;text-decoration:none;">Términos</a> ·
            <a href="mailto:hola@tradyncapp.com" style="color:#3a4060;text-decoration:none;">hola@tradyncapp.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'Tradync <hola@tradyncapp.com>',
      to: email,
      subject: '¡Bienvenido a Tradync! Tu journal de trading está listo 🎯',
      html: htmlContent,
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(400).json({ error });
    }

    return res.status(200).json({ success: true, id: data?.id });
  } catch (e) {
    console.error('Welcome email error:', e);
    return res.status(500).json({ error: e.message });
  }
}
