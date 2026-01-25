const blockchainService = require('../utils/blockchain');
const { query } = require('../utils/database');
const { logger } = require('../utils/logger');
const { ethers } = require('ethers');

const RELEASE_ABI = ["function releaseFunds(bytes32 escrowId, address to) external"];

async function releaseFunds(req, res) {
  const { input, session_variables } = req.body;
  const { escrow_transaction_id, recipient_address } = input;
  
  if (session_variables['x-hasura-role'] !== 'admin') {
      return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  try {
    const check = await query(`SELECT status FROM escrow_transactions WHERE id = $1`, [escrow_transaction_id]);
    if (check.rows.length === 0 || check.rows[0].status !== 'active') {
        return res.status(400).json({ success: false, message: "Escrow not ready" });
    }

    const signer = await blockchainService.getSigner();
    const contract = new ethers.Contract(process.env.ESCROW_CONTRACT_ADDRESS, RELEASE_ABI, signer);
    
    const escrowIdBytes32 = "0x" + escrow_transaction_id.replace(/-/g, ""); 
    const tx = await contract.releaseFunds(escrowIdBytes32, recipient_address);
    const receipt = await tx.wait(1);

    await query(`UPDATE escrow_transactions SET status = 'released', updated_at = NOW() WHERE id = $1`, [escrow_transaction_id]);

    return res.json({
      success: true, message: "Funds released", transaction_hash: receipt.hash,
      recipient: recipient_address, release_amount: "100.00", estimated_gas: receipt.gasUsed.toString()
    });
  } catch (error) {
    logger.error(`Release Error: ${error.message}`);
    return res.status(500).json({ success: false, message: error.message });
  }
}
module.exports = releaseFunds;