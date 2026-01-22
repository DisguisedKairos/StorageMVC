const fetch = require("node-fetch");
require("dotenv").config();

const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API || "https://api-m.sandbox.paypal.com";

async function getAccessToken() {
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || "Failed to get PayPal access token");
  }
  return data.access_token;
}

async function createOrder({ amount, referenceId, returnUrl, cancelUrl }) {
  const accessToken = await getAccessToken();

  const payload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        ...(referenceId ? { reference_id: referenceId } : {}),
        amount: { currency_code: "SGD", value: String(amount) },
      },
    ],
  };

  if (returnUrl && cancelUrl) {
    payload.application_context = {
      return_url: returnUrl,
      cancel_url: cancelUrl,
    };
  }

  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Failed to create PayPal order");
  }
  return data;
}

async function captureOrder(orderId) {
  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Failed to capture PayPal order");
  }

  return data;
}

module.exports = { createOrder, captureOrder };
