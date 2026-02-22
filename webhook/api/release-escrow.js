const { query } = require('../utils/database');
const { logger } = require('../utils/logger');
const axios = require('axios');

async function releaseEscrow(req, res) {
  const { contractId } = req.body; 
  
  const userRole = req.user?.role; 
  const userId = req.user?.userId;

  try {
    logger.info(`Received request to release escrow for contractId: ${contractId}`);

    if (!userId || userRole === 'anonymous') {
      return res.status(401).json({ success: false, message: "Unauthorized: Valid JWT required" });
    }

    if (!contractId) {
      return res.status(400).json({ success: false, message: "Missing contractId" });
    }

    const escrowQuery = await query(`
      SELECT id, status, marker
      FROM trustless_work_escrows
      WHERE contract_id = $1
    `, [contractId]);

    if (escrowQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Escrow contract not found" });
    }

    const escrow = escrowQuery.rows[0];

    const validPreReleaseStates = ['funded', 'active', 'milestone_approved'];
    if (!validPreReleaseStates.includes(escrow.status)) {
        return res.status(400).json({ success: false, message: `Escrow cannot be released from '${escrow.status}' state.` });
    }

    const userWalletResult = await query(
      `SELECT wallet_address FROM user_wallets WHERE user_id = $1`, 
      [userId]
    );
    const userWalletAddress = userWalletResult.rows[0]?.wallet_address;

    const isPropertyOwner = userWalletAddress && escrow.marker === userWalletAddress;
    const isPlatformAdmin = userRole === 'admin' || userRole === 'platform';

    if (!isPropertyOwner && !isPlatformAdmin) {
        return res.status(403).json({ success: false, message: "Unauthorized: Only the property owner or platform admin can release funds." });
    }

    const releaseSigner = isPropertyOwner ? userWalletAddress : (userWalletAddress || process.env.PLATFORM_WALLET_ADDRESS);

    if (!releaseSigner) {
        return res.status(400).json({ success: false, message: "Signer wallet address not found." });
    }

    const trustlessWorkUrl = process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com';
    const trustlessWorkApiKey = process.env.TRUSTLESS_WORK_API_KEY;

    if (!trustlessWorkApiKey) {
        throw new Error("Missing TRUSTLESS_WORK_API_KEY environment variable");
    }

    let twResponse;
    try {
        twResponse = await axios.post(
            `${trustlessWorkUrl}/escrow/single-release/release-funds`, 
            {
                contractId: contractId,
                releaseSigner: releaseSigner 
            }, 
            {
                headers: {
                    'x-api-key': trustlessWorkApiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 10000 
            }
        );
    } catch (twError) {
        logger.error(`Trustless Work API Error: ${twError.response?.data?.message || twError.message}`);
        
        return res.status(twError.response?.status || 502).json({ 
            success: false, 
            message: "Failed to communicate with Trustless Work API", 
            errorCode: twError.response?.data?.code || "EXTERNAL_API_ERROR"
        });
    }

    const unsignedXdr = twResponse.data.unsignedTransaction;

    if (!unsignedXdr) {
        throw new Error("Trustless Work API did not return an unsignedTransaction");
    }

    const updateResult = await query(`
      UPDATE trustless_work_escrows
      SET status = 'release_pending', updated_at = NOW()
      WHERE contract_id = $1
      AND status IN ('funded', 'active', 'milestone_approved')
    `, [contractId]);

    if (updateResult.rowCount === 0) {
       return res.status(409).json({ success: false, message: "Escrow state changed before release could complete." });
    }

    logger.info(`Escrow ${contractId} set to release_pending. XDR generated.`);
    return res.status(200).json({
        success: true,
        message: "Escrow funds ready for signature",
        contractId: contractId,
        unsignedXdr: unsignedXdr 
    });

  } catch (error) {
    logger.error(`Release Escrow Error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = releaseEscrow;