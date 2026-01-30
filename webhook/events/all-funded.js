const { logger } = require('../utils/logger');
const escrowStateService = require('../services/escrow-state.service');
const notificationService = require('../services/notification.service');

/**
 * Handle all parties funded event
 * Triggered when all participants have funded the escrow
 * This can be called directly from user-funded handler or as a separate event
 */
async function handleAllFunded(req, res) {
  // Handle both direct calls and HTTP requests
  const escrowId = req.body?.event?.data?.new?.id || 
                   req.body?.escrow_id ||
                   (typeof req === 'object' && req.escrow_id) ||
                   null;

  if (!escrowId) {
    const error = 'Escrow ID is required';
    logger.error('All funded event error:', { error });
    if (res && res.status) {
      return res.status(400).json({ success: false, message: error });
    }
    throw new Error(error);
  }

  try {
    logger.info('All funded event received', { escrow_id: escrowId });

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

    // 2. Update escrow status to active
    // Note: Adapt status value based on actual enum values
    await escrowStateService.updateEscrowStatus(escrowId, 'ACTIVE', {
      metadata: {
        activated_at: new Date().toISOString(),
        activation_reason: 'all_parties_funded',
      },
    });

    logger.info('Escrow activated - all parties funded', { escrow_id: escrowId });

    // 3. Get participants to notify
    const participants = await escrowStateService.getParticipants(escrowId);

    // 4. Send activation notification to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'escrow-activated',
          data: {
            participant_name: participant.display_name,
            escrow_id: escrow.id,
            contract_id: escrow.contract_id,
          },
        });
      } catch (error) {
        logger.error('Failed to send activation notification', {
          error: error.message,
          participant: participant.email,
        });
      }
    });

    await Promise.allSettled(notificationPromises);

    const result = {
      success: true,
      message: 'All funded event processed',
      escrow_id: escrow.id,
      status: 'ACTIVE',
      participants_notified: participants.length,
    };

    if (res && res.json) {
      return res.json(result);
    }

    return result;
  } catch (error) {
    logger.error('All funded event error:', {
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

module.exports = handleAllFunded;
