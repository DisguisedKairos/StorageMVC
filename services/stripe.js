const Stripe = require("stripe");

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return Stripe(key);
}

function getBaseUrl() {
  return process.env.APP_BASE_URL || `http://localhost:${process.env.APP_PORT || 3000}`;
}

async function createCheckoutSession({ amount, reference, userId, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const baseUrl = getBaseUrl();
  const amountCents = Math.round((parseFloat(amount) || 0) * 100);

  if (!amountCents) {
    throw new Error("Invalid Stripe amount");
  }

  const finalSuccessUrl = successUrl || `${baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`;
  const finalCancelUrl = cancelUrl || `${baseUrl}/stripe/cancel`;

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "sgd",
          unit_amount: amountCents,
          product_data: {
            name: reference || "Storage Booking",
          },
        },
      },
    ],
    success_url: finalSuccessUrl,
    cancel_url: finalCancelUrl,
    metadata: {
      userId: String(userId || ""),
    },
  });
}

async function retrieveCheckoutSession(sessionId) {
  const stripe = getStripe();
  return stripe.checkout.sessions.retrieve(sessionId);
}

module.exports = { createCheckoutSession, retrieveCheckoutSession };
