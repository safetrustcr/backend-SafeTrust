const { logger } = require('../utils/logger');
const notificationService = require('../services/notification.service');
const escrowStateService = require('../services/escrow-state.service');

/**
 * Handle escrow created event
 * Triggered when a new escrow_transaction is inserted
 * 
 * Hasura event payload structure:
 * {
 *   event: {
 *     session_variables: {...},
 *     op: 'INSERT',
 *     data: {
 *       old: null,
 *       new: { ...escrow data... }
 *     }
 *   },
 *   table: { name: 'escrow_transactions', schema: 'public' },
 *   trigger: { name: 'on_escrow_created' }
 * }
 */
async function handleEscrowCreated(req, res) {
  const { event, table, trigger } = req.body;
  const { new: newData } = event.data;

  try {
    logger.info('Escrow created event received', {
      escrow_id: newData.id,
      contract_id: newData.contract_id,
      status: newData.status,
    });

    // 1. Get escrow details
    const escrow = await escrowStateService.getEscrow(newData.id);
    if (!escrow) {
      logger.warn('Escrow not found after creation', { escrow_id: newData.id });
      return res.status(404).json({
        success: false,
        message: 'Escrow not found',
      });
    }

    // 2. Get participants to notify
    const participants = await escrowStateService.getParticipants(newData.id);

    // 3. Send welcome notifications to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'escrow-created',
          data: {
            participant_name: participant.display_name,
            escrow_id: escrow.id,
            contract_id: escrow.contract_id,
            amount: escrow.amount,
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

    // 4. Log escrow creation event
    logger.info('Escrow created event processed', {
      escrow_id: escrow.id,
      participants_notified: participants.length,
    });

    // 5. Return success response
    return res.json({
      success: true,
      message: 'Escrow created event processed',
      escrow_id: escrow.id,
      contract_id: escrow.contract_id,
      participants_notified: participants.length,
    });
  } catch (error) {
    logger.error('Escrow created event error:', {
      error: error.message,
      stack: error.stack,
      escrow_id: newData?.id,
    });

    return res.status(500).json({
      success: false,
      message: 'Event processing failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

module.exports = handleEscrowCreated;
