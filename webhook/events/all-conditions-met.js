const { logger } = require('../utils/logger');
const escrowStateService = require('../services/escrow-state.service');
const notificationService = require('../services/notification.service');
const blockchainService = require('../services/blockchain.service');

/**
 * Handle all conditions met event
 * Triggered when all milestones/conditions are verified
 * This automatically triggers fund release
 */
async function handleAllConditionsMet(req, res) {
  // Handle both direct calls and HTTP requests
  const escrowId = req.body?.event?.data?.new?.id || 
                   req.body?.escrow_id ||
                   (typeof req === 'object' && req.escrow_id) ||
                   null;

  if (!escrowId) {
    const error = 'Escrow ID is required';
    logger.error('All conditions met event error:', { error });
    if (res && res.status) {
      return res.status(400).json({ success: false, message: error });
    }
    throw new Error(error);
  }

  try {
    logger.info('All conditions met event received', { escrow_id: escrowId });

    // 1. Get escrow details
    const escrow = await escrowStateService.getEscrow(escrowId);
    if (!escrow) {
      const error = 'Escrow not found';
      logger.warn(error, { escrow_id: escrowId });
      if (res && res.status) {
        return res.status(404).json({ success: false, message: error });
      }
      throw new Error(error);
    }

    // 2. Verify escrow is in active status
    if (escrow.status !== 'ACTIVE' && escrow.status !== 'active') {
      logger.warn('Escrow not in active status, cannot release funds', {
        escrow_id: escrowId,
        current_status: escrow.status,
      });
      if (res && res.status) {
        return res.status(400).json({
          success: false,
          message: `Escrow not in active status: ${escrow.status}`,
        });
      }
      return { success: false, message: `Escrow not in active status: ${escrow.status}` };
    }

    // 3. Double-check all conditions are met
    const conditionCheck = await escrowStateService.checkAllConditionsMet(escrowId);
    if (!conditionCheck.allMet) {
      logger.warn('Not all conditions met, cannot release funds', {
        escrow_id: escrowId,
        verified: conditionCheck.verified,
        total: conditionCheck.total,
      });
      if (res && res.status) {
        return res.status(400).json({
          success: false,
          message: 'Not all conditions are met',
        });
      }
      return { success: false, message: 'Not all conditions are met' };
    }

    // 4. Call smart contract to release funds
    // TODO: Get recipient address from escrow data or participants
    const recipientAddress = escrow.signer_address || null; // Adapt based on schema
    const amount = escrow.amount;

    if (!recipientAddress) {
      logger.warn('No recipient address found, cannot release funds', {
        escrow_id: escrowId,
      });
      if (res && res.status) {
        return res.status(400).json({
          success: false,
          message: 'Recipient address not found',
        });
      }
      return { success: false, message: 'Recipient address not found' };
    }

    logger.info('Releasing funds via blockchain', {
      escrow_id: escrowId,
      contract_id: escrow.contract_id,
      recipient: recipientAddress,
      amount,
    });

    const releaseResult = await blockchainService.releaseFunds(
      escrowId,
      escrow.contract_id,
      recipientAddress,
      amount
    );

    // 5. Update escrow status to released
    await escrowStateService.updateEscrowStatus(escrowId, 'RELEASED', {
      metadata: {
        released_at: new Date().toISOString(),
        release_tx_hash: releaseResult.transactionHash,
        release_block_number: releaseResult.blockNumber,
      },
    });

    // 6. Get participants to notify
    const participants = await escrowStateService.getParticipants(escrowId);

    // 7. Send completion notification to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'all-conditions-met',
          data: {
            participant_name: participant.display_name,
            escrow_id: escrow.id,
            contract_id: escrow.contract_id,
          },
        });
      } catch (error) {
        logger.error('Failed to send notification', {
          error: error.message,
          participant: participant.email,
        });
      }
    });

    await Promise.allSettled(notificationPromises);

    const result = {
      success: true,
      message: 'All conditions met, funds released',
      escrow_id: escrow.id,
      transaction_hash: releaseResult.transactionHash,
      participants_notified: participants.length,
    };

    if (res && res.json) {
      return res.json(result);
    }

    return result;
  } catch (error) {
    logger.error('All conditions met event error:', {
      error: error.message,
      stack: error.stack,
      escrow_id: escrowId,
    });

    if (res && res.status) {
      return res.status(500).json({
        success: false,
        message: 'Event processing failed',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }

    throw error;
  }
}

module.exports = handleAllConditionsMet;
