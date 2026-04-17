import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { priceId, userId, userEmail } = req.body;
  if (!priceId || !userId) return res.status(400).json({ error: 'Missing fields' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: userEmail,
      client_reference_id: userId,
      subscription_data: {
        trial_period_days: 14,
        metadata: { user_id: userId }
      },
      success_url: process.env.APP_URL + '/tradync-app.html?payment=success',
      cancel_url: process.env.APP_URL + '/tradync-app.html?payment=cancelled',
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Checkout error:', e);
    return res.status(500).json({ error: e.message });
  }
}
