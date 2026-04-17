import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: 'Webhook signature failed: ' + e.message });
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const PRICE_ANNUAL = 'price_1TNBwcP0m8lsmKp7ruN7tSbo';

  console.log('Webhook event:', event.type);

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id;
      const customerId = session.customer;
      const subId = session.subscription;

      console.log('Checkout completed for user:', userId);

      if (!userId) {
        console.error('No user_id in session');
        return res.status(200).json({ received: true });
      }

      // Get subscription to find price
      const subscription = await stripe.subscriptions.retrieve(subId);
      const priceId = subscription.items.data[0]?.price?.id;
      const isAnnual = priceId === PRICE_ANNUAL;
      const fechaFin = new Date(subscription.current_period_end * 1000).toISOString();

      // Check if row exists
      const { data: existing } = await sb.from('suscripciones')
        .select('id').eq('user_id', userId).single();

      if (existing) {
        await sb.from('suscripciones').update({
          plan: 'pro',
          activa: true,
          fecha_inicio: new Date().toISOString(),
          fecha_fin: fechaFin,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          updated_at: new Date().toISOString()
        }).eq('user_id', userId);
      } else {
        await sb.from('suscripciones').insert({
          user_id: userId,
          plan: 'pro',
          activa: true,
          fecha_inicio: new Date().toISOString(),
          fecha_fin: fechaFin,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          updated_at: new Date().toISOString()
        });
      }
      console.log('Plan updated to pro for user:', userId);
    }

    else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await sb.from('suscripciones')
        .update({ plan: 'free', activa: false, updated_at: new Date().toISOString() })
        .eq('stripe_customer_id', sub.customer);
    }

    else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const active = sub.status === 'active' || sub.status === 'trialing';
      const fechaFin = new Date(sub.current_period_end * 1000).toISOString();
      await sb.from('suscripciones')
        .update({
          activa: active,
          plan: active ? 'pro' : 'free',
          fecha_fin: fechaFin,
          updated_at: new Date().toISOString()
        })
        .eq('stripe_customer_id', sub.customer);
    }

    else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      await sb.from('suscripciones')
        .update({ activa: false, plan: 'free', updated_at: new Date().toISOString() })
        .eq('stripe_customer_id', invoice.customer);
    }

    return res.status(200).json({ received: true });
  } catch(e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
