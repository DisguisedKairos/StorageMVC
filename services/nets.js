const axios = require("axios");
const crypto = require("crypto");

function getHeaders() {
  const apiKey = (process.env.NETS_API_KEY || process.env.API_KEY || "").trim();
  const projectId = (process.env.NETS_PROJECT_ID || process.env.PROJECT_ID || "").trim();
  return {
    "api-key": apiKey,
    "project-id": projectId,
    "Content-Type": "application/json",
  };
}

function getBaseUrl() {
  return (process.env.NETS_BASE_URL || "https://sandbox.nets.openapipaas.com").replace(/\/+$/, "");
}

function getPaths() {
  return {
    requestPath: process.env.NETS_QR_REQUEST_PATH || "/api/v1/common/payments/nets-qr/request",
    queryPath: process.env.NETS_QR_QUERY_PATH || "/api/v1/common/payments/nets-qr/query",
  };
}

async function requestQr({ amount, txnId, notifyMobile = 0 }) {
  const baseUrl = getBaseUrl();
  const { requestPath } = getPaths();
  const url = `${baseUrl}${requestPath}`;

  const fallbackTxnId =
    (process.env.NETS_TXN_ID || "").trim() || `sandbox_nets|m|${crypto.randomUUID()}`;

  const requestBody = {
    txn_id: txnId || fallbackTxnId,
    amt_in_dollars: (() => {
      const parsed = Number.parseFloat(amount);
      return Number.isFinite(parsed) ? parsed : amount;
    })(),
    notify_mobile: notifyMobile,
  };

  const headers = getHeaders();
  console.log("NETS requestQr ->", { url, headers, requestBody });

  let response;
  try {
    response = await axios.post(url, requestBody, { headers });
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const respHeaders = err?.response?.headers;
    console.error("NETS requestQr error ->", { url, status, data, respHeaders });
    throw err;
  }

  const data = response.data?.result?.data || response.data?.result?.data?.data || response.data?.result?.data || {};
  const qrCodeBase64 = data.qr_code;
  const txnRetrievalRef = data.txn_retrieval_ref;

  const qrCodeDataUrl = qrCodeBase64 ? `data:image/png;base64,${qrCodeBase64}` : "";

  return { qrCodeDataUrl, txnRetrievalRef, raw: response.data };
}

async function queryTxn({ txnRetrievalRef, frontendTimeoutStatus = 0 }) {
  const baseUrl = getBaseUrl();
  const { queryPath } = getPaths();

  const body = {
    txn_retrieval_ref: txnRetrievalRef,
    frontend_timeout_status: frontendTimeoutStatus,
  };

  const response = await axios.post(`${baseUrl}${queryPath}`, body, { headers: getHeaders() });

  const d = response.data?.result?.data || {};
  return {
    responseCode: String(d.response_code ?? ""),
    txnStatus: Number(d.txn_status ?? 0),
    raw: response.data,
  };
}

module.exports = { requestQr, queryTxn };
