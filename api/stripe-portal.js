import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, userEmail } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // Get stripe customer ID from suscripciones table
    const { data: sub } = await sb.from('suscripciones')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = sub?.stripe_customer_id;

    // If no customer ID, create one
    if (!customerId) {
      const customer = await stripe.customers.create({ email: userEmail });
      customerId = customer.id;
    }

    // Create billing portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: process.env.APP_URL + '/tradync-app.html',
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Portal error:', e);
    return res.status(500).json({ error: e.message });
  }
}
