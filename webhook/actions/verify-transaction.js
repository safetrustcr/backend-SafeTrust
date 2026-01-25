const blockchainService = require('../utils/blockchain');
const { executeTransaction } = require('../utils/database');
const { logger } = require('../utils/logger');
const { ethers } = require('ethers');

async function verifyTransaction(req, res) {
  const { input } = req.body;
  const { escrow_transaction_id, user_id, transaction_hash, wallet_address } = input;
  const network = process.env.BLOCKCHAIN_NETWORK || 'polygon';

  try {
    // 1. Verify on Chain
    const verification = await blockchainService.verifyTransactionConfirmed(transaction_hash, network);
    if (!verification.verified) return res.json({ success: false, verified: false, message: verification.reason });

    const tx = verification.transaction;

    // 2. Security Checks
    if (tx.from.toLowerCase() !== wallet_address.toLowerCase()) {
        return res.json({ success: false, verified: false, message: "Sender mismatch" });
    }
    const expectedContract = process.env.ESCROW_CONTRACT_ADDRESS;
    if (tx.to && expectedContract && tx.to.toLowerCase() !== expectedContract.toLowerCase()) {
        return res.json({ success: false, verified: false, message: "Sent to wrong address" });
    }

    // 3. Atomic Update
    const result = await executeTransaction(async (client) => {
      const q = await client.query(`
        SELECT et.id, etu.amount as required_amount, etu.funding_status
        FROM escrow_transactions et
        JOIN escrow_transaction_users etu ON et.id = etu.escrow_transaction_id
        WHERE et.id = $1 AND etu.user_id = $2
        FOR UPDATE OF et
      `, [escrow_transaction_id, user_id]);

      if (q.rows.length === 0) throw new Error('Escrow not found');
      const escrow = q.rows[0];

      if (escrow.funding_status === 'funded') return { already_funded: true };

      const requiredWei = ethers.parseEther(escrow.required_amount.toString());
      const sentWei = ethers.parseEther(tx.value.toString());
      if (sentWei < requiredWei) throw new Error(`Insufficient funds`);

      await client.query(`
        UPDATE escrow_transaction_users
        SET funding_status = 'funded', funded_at = NOW(), blockchain_tx_hash = $1, amount = $2
        WHERE escrow_transaction_id = $3 AND user_id = $4
      `, [transaction_hash, tx.value, escrow_transaction_id, user_id]);

      const statusQ = await client.query(`
        SELECT COUNT(*) as total, COUNT(CASE WHEN funding_status = 'funded' THEN 1 END) as funded
        FROM escrow_transaction_users WHERE escrow_transaction_id = $1
      `, [escrow_transaction_id]);

      const isComplete = statusQ.rows[0].total === statusQ.rows[0].funded;
      if (isComplete) {
        await client.query(`UPDATE escrow_transactions SET status = 'active', updated_at = NOW() WHERE id = $1`, [escrow_transaction_id]);
      }
      return { success: true, funding_complete: isComplete };
    });

    if (result.already_funded) return res.json({ success: true, verified: true, message: 'Already funded', confirmations: 999, block_number: tx.blockNumber, funding_complete: false });

    return res.json({
      success: true, verified: true, message: 'Verified',
      confirmations: tx.confirmations, 
      block_number: tx.blockNumber,
      funding_complete: result.funding_complete
    });

  } catch (error) {
    logger.error(`Verify Tx Error: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
}
module.exports = verifyTransaction;