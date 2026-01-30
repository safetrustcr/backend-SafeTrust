const blockchainService = require('../utils/blockchain');
const { executeTransaction } = require('../utils/database');
const { logger } = require('../utils/logger');
const { ethers } = require('ethers');

const REFUND_ABI = ["function processRefund(bytes32 escrowId, address to) external"];

async function processRefund(req, res) {
  const { input, session_variables } = req.body;
  const { escrow_transaction_id, user_id, reason, amount, refund_address } = input;

  const requestorId = session_variables['x-hasura-user-id'];
  const role = session_variables['x-hasura-role'];
  
  if (role !== 'admin' && requestorId !== user_id) {
     return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  try {
    // 1. Execute Blockchain Call
    const signer = await blockchainService.getSigner();
    const contract = new ethers.Contract(process.env.ESCROW_CONTRACT_ADDRESS, REFUND_ABI, signer);
    
    const escrowIdBytes32 = "0x" + escrow_transaction_id.replace(/-/g, ""); 
    // Admin triggers refund to specific address
    const tx = await contract.processRefund(escrowIdBytes32, refund_address);
    const receipt = await tx.wait(1);

    // 2. Atomic DB Update
    await executeTransaction(async (client) => {
        const check = await client.query(`SELECT status FROM escrow_transactions WHERE id = $1 FOR UPDATE`, [escrow_transaction_id]);
        if (check.rows.length === 0 || check.rows[0].status === 'released') throw new Error("Invalid state");

        await client.query(`
            INSERT INTO refund_history (escrow_transaction_id, user_id, reason, amount, transaction_hash, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [escrow_transaction_id, user_id, reason, amount, receipt.hash]);

        await client.query(`
            UPDATE escrow_transaction_users SET funding_status = 'refunded', updated_at = NOW() 
            WHERE escrow_transaction_id = $1 AND user_id = $2
        `, [escrow_transaction_id, user_id]);
    });

    return res.json({
      success: true, message: "Refund processed", refund_id: escrow_transaction_id,
      refund_status: "refunded", transaction_hash: receipt.hash, refund_amount: amount
    });
  } catch (error) {
    logger.error(`Refund Error: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
}
module.exports = processRefund;