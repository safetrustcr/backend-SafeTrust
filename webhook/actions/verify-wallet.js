const blockchainService = require('../utils/blockchain');
const { query } = require('../utils/database');
const { logger } = require('../utils/logger');

async function verifyWallet(req, res) {
  const { input } = req.body;
  const { user_id, wallet_address, signature, message } = input;

  try {
    const isValid = blockchainService.verifySignature(message, signature, wallet_address);

    if (!isValid) {
      return res.status(400).json({
        success: false, verified: false, message: "Invalid signature"
      });
    }

    await query(
      `INSERT INTO user_wallets (user_id, wallet_address, verified_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET wallet_address = $2, verified_at = NOW()`,
      [user_id, wallet_address]
    );

    return res.json({
      success: true, verified: true, message: "Wallet verified", wallet_id: user_id
    });
  } catch (error) {
    logger.error(`Verify Wallet Error: ${error.message}`);
    return res.status(500).json({ success: false, verified: false, message: "Internal Error" });
  }
}
module.exports = verifyWallet;