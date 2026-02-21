const { query } = require('../utils/database');
const { logger } = require('../utils/logger');
const axios = require('axios');

async function releaseEscrow(req, res) {
  const { contractId, senderAddress } = req.body;
  
  const userRole = req.user?.role; 
  const userId = req.user?.userId;

  try {
    logger.info(`Received request to release escrow for contractId: ${contractId}`);

    // Auth Check
    if (!userId || userRole === 'anonymous') {
      return res.status(401).json({ success: false, message: "Unauthorized: Valid JWT required" });
    }

    // Validate Input
    if (!contractId || !senderAddress) {
      return res.status(400).json({ success: false, message: "Missing contractId or senderAddress" });
    }

    // Fetch Escrow Details
    const escrowQuery = await query(`
      SELECT id, status, marker, releaser
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

    // Validate Permissions (Only Property Owner or Platform Admin)
    const isPropertyOwner = escrow.marker === senderAddress;
    const isPlatformAdmin = userRole === 'admin' || userRole === 'platform';

    if (!isPropertyOwner && !isPlatformAdmin) {
        return res.status(403).json({ success: false, message: "Unauthorized: Only the property owner or platform admin can release funds." });
    }

    // Call Trustless Work API
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
                releaseSigner: senderAddress 
            }, 
            {
                headers: {
                    'x-api-key': trustlessWorkApiKey,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (twError) {
        logger.error(`Trustless Work API Error: ${twError.response?.data?.message || twError.message}`);
        return res.status(twError.response?.status || 502).json({ 
            success: false, 
            message: "Failed to communicate with Trustless Work API", 
            details: twError.response?.data 
        });
    }

    const unsignedXdr = twResponse.data.unsignedTransaction;

    if (!unsignedXdr) {
        throw new Error("Trustless Work API did not return an unsignedTransaction");
    }

    // Update Database Status to 'completed'
    await query(`
      UPDATE trustless_work_escrows
      SET status = 'completed', updated_at = NOW()
      WHERE contract_id = $1
    `, [contractId]);

    // Return Response
    logger.info(`Escrow ${contractId} released successfully. XDR generated.`);
    return res.status(200).json({
        success: true,
        message: "Escrow funds released successfully",
        contractId: contractId,
        unsignedXdr: unsignedXdr 
    });

  } catch (error) {
    logger.error(`Release Escrow Error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = releaseEscrow;