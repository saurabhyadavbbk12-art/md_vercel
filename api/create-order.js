const Razorpay = require('razorpay');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const { amount, currency } = req.body;
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    const options = {
      amount: amount * 100,
      currency: currency || 'INR',
      receipt: `receipt_${Date.now()}`,
    };
    const order = await razorpay.orders.create(options);
    return res.status(200).json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error('Razorpay order creation failed:', error);
    return res.status(500).json({ error: 'Order creation failed' });
  }
}
