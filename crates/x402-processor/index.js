'use strict';

try {
  module.exports = require('./index.node');
} catch (err) {
  const allowedFacilitators = [
    'https://x402.org/facilitator',
    'https://channels.openzeppelin.com/x402/testnet',
    'https://channels.openzeppelin.com/x402',
  ];

  function isAllowedFacilitator(url) {
    if (!url) return true; // Default facilitator used if empty
    return allowedFacilitators.some((allowed) => url === allowed || url.startsWith(allowed + '/'));
  }

  function validateX402Payment(header, requiredAmount) {
    if (!header || !header.startsWith('x402 ')) {
      return JSON.stringify({
        is_valid: false,
        payer_address: null,
        amount_usdc: 0.0,
        network: '',
        invalid_reason: `Invalid X-Payment header format — must start with 'x402 ', got: '${header || ''}'`,
      });
    }

    try {
      const b64 = header.slice(5).trim();
      const payloadStr = Buffer.from(b64, 'base64').toString('utf8');
      const payment = JSON.parse(payloadStr);

      if (!payment.network || !payment.network.startsWith('stellar')) {
        return JSON.stringify({
          is_valid: false,
          payer_address: null,
          amount_usdc: 0.0,
          network: payment.network || '',
          invalid_reason: `Unsupported network: '${payment.network}' — SafeTrust only accepts Stellar payments`,
        });
      }

      if (payment.amount === undefined || payment.amount === null || payment.amount <= 0) {
        return JSON.stringify({
          is_valid: false,
          payer_address: null,
          amount_usdc: 0.0,
          network: payment.network,
          invalid_reason: `Invalid payment amount: ${payment.amount} — must be positive`,
        });
      }

      const facilitatorUrl = payment.facilitatorUrl || payment.facilitator_url;
      if (facilitatorUrl && !isAllowedFacilitator(facilitatorUrl)) {
        return JSON.stringify({
          is_valid: false,
          payer_address: null,
          amount_usdc: 0.0,
          network: payment.network,
          invalid_reason: `Untrusted facilitator URL: ${facilitatorUrl}`,
        });
      }

      if (payment.amount < requiredAmount) {
        return JSON.stringify({
          is_valid: false,
          payer_address: null,
          amount_usdc: payment.amount,
          network: payment.network,
          invalid_reason: `Insufficient payment amount: ${payment.amount} USDC provided, ${requiredAmount} USDC required`,
        });
      }

      return JSON.stringify({
        is_valid: true,
        payer_address: payment.payer_address || payment.payerAddress || payment.pay_to || null,
        amount_usdc: payment.amount,
        network: payment.network,
        invalid_reason: null,
      });
    } catch (e) {
      return JSON.stringify({
        is_valid: false,
        payer_address: null,
        amount_usdc: 0.0,
        network: '',
        invalid_reason: e.message,
      });
    }
  }

  function buildPaymentRequirement(amountUsdc, network, facilitatorUrl, payTo) {
    const isMainnet = network.includes('mainnet');
    const contract = isMainnet
      ? 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
      : 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
    const issuer = isMainnet
      ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
      : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

    return JSON.stringify({
      scheme: 'exact',
      network,
      max_amount_usdc: amountUsdc,
      asset: {
        code: 'USDC',
        contract,
        issuer,
      },
      facilitator_url: facilitatorUrl,
      pay_to: payTo,
      description: 'SafeTrust booking fee',
    });
  }

  module.exports = {
    validateX402Payment,
    buildPaymentRequirement,
  };
}
