// api/stripe-webhook.js - Vercel Serverless Function
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return res.status(400).json({ error: 'Webhook signature failed' });
  }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const PRICE_MONTHLY = 'price_1TNBwGP0m8lsmKp7jtgrjZaQ';
  const PRICE_ANNUAL  = 'price_1TNBwcP0m8lsmKp7ruN7tSbo';

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const priceId = session.line_items?.data?.[0]?.price?.id;
        const plan = priceId === PRICE_ANNUAL ? 'pro_anual' : 'pro';
        const subId = session.subscription;
        const customerId = session.customer;

        // Calculate end date
        const fechaFin = priceId === PRICE_ANNUAL
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // Upsert subscription
        await sb.from('suscripciones').upsert({
          user_id: userId,
          plan: 'pro',
          activa: true,
          fecha_inicio: new Date().toISOString(),
          fecha_fin: fechaFin,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        break;
      }

      case 'customer.subscription.deleted':
      case 'customer.subscription.paused': {
        const sub = event.data.object;
        const customerId = sub.customer;
        // Find user by stripe customer id and downgrade
        await sb.from('suscripciones')
          .update({ plan: 'free', activa: false, updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer;
        const active = sub.status === 'active' || sub.status === 'trialing';
        const fechaFin = new Date(sub.current_period_end * 1000).toISOString();
        await sb.from('suscripciones')
          .update({
            activa: active,
            plan: active ? 'pro' : 'free',
            fecha_fin: fechaFin,
            updated_at: new Date().toISOString()
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        await sb.from('suscripciones')
          .update({ activa: false, plan: 'free', updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', customerId);
        break;
      }
    }

    res.status(200).json({ received: true });
  } catch(e) {
    console.error('Webhook handler error:', e);
    res.status(500).json({ error: e.message });
  }
}
