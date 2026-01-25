const blockchainService = require('../utils/blockchain');
const { query } = require('../utils/database');
const { logger } = require('../utils/logger');
const { ethers } = require('ethers');

const DEPOSIT_ABI = ["function deposit(bytes32 escrowId) external payable"];

async function initiateFunding(req, res) {
  const { input } = req.body;
  const { escrow_transaction_id, user_id, amount, wallet_address } = input;
  const network = process.env.BLOCKCHAIN_NETWORK || 'polygon';

  try {
    // 1. Validation
    const check = await query(`
      SELECT et.status, etu.amount as required_amount 
      FROM escrow_transactions et
      JOIN escrow_transaction_users etu ON et.id = etu.escrow_transaction_id
      WHERE et.id = $1 AND etu.user_id = $2
    `, [escrow_transaction_id, user_id]);

    if (check.rows.length === 0) return res.status(404).json({ success: false, message: "Not a participant" });
    const { status, required_amount } = check.rows[0];

    if (status !== 'pending' && status !== 'active') {
       return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
    }

    const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
    const escrowIdBytes32 = "0x" + escrow_transaction_id.replace(/-/g, "");

    // 2. Estimate Gas using Service
    // estimateGas expects (address, abi, method, params, network)
    // mock the params for deposit
    const gasData = await blockchainService.estimateGas(
        contractAddress, 
        DEPOSIT_ABI, 
        "deposit", 
        [escrowIdBytes32, { value: ethers.parseEther(amount) }], 
        network
    );

    // 3. Generate Tx Data
    const iface = new ethers.Interface(DEPOSIT_ABI);
    const txData = iface.encodeFunctionData("deposit", [escrowIdBytes32]);

    return res.json({
      success: true,
      message: "Ready to fund",
      contract_address: contractAddress,
      contract_abi: DEPOSIT_ABI,
      required_amount: required_amount.toString(),
      gas_estimate: gasData.gasLimit,
      transaction_data: {
          to: contractAddress, data: txData, value: amount
      }
    });
  } catch (error) {
    logger.error(`Funding Error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Internal Error" });
  }
}
module.exports = initiateFunding;