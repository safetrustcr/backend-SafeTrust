const { logger } = require('../utils/logger');
const { query } = require('../utils/database');
const escrowStateService = require('../services/escrow-state.service');
const notificationService = require('../services/notification.service');
const blockchainService = require('../services/blockchain.service');

/**
 * Handle refund requested event
 * Triggered when:
 * - INSERT on refund_requests table (if exists)
 * - UPDATE on escrow_transactions where refund_status changes
 * - UPDATE on escrow_transactions where cancellation_reason is set
 */
async function handleRefundRequested(req, res) {
  const { event, table, trigger } = req.body;
  const { new: newData, old: oldData } = event.data;

  try {
    logger.info('Refund requested event received', {
      record_id: newData.id,
      escrow_id: newData.escrow_transaction_id || newData.id,
      refund_status: newData.refund_status,
      cancellation_reason: newData.cancellation_reason,
    });

    const escrowId = newData.escrow_transaction_id || newData.id;

    // 1. Get escrow details
    const escrow = await escrowStateService.getEscrow(escrowId);
    if (!escrow) {
      logger.warn('Escrow not found', { escrow_id: escrowId });
      return res.status(404).json({
        success: false,
        message: 'Escrow not found',
      });
    }

    // 2. Validate refund eligibility
    const canAutoRefund = 
      (escrow.status === 'PENDING' || escrow.status === 'pending') &&
      !escrow.completed_at &&
      escrow.created_at &&
      (new Date() - new Date(escrow.created_at)) < (7 * 24 * 60 * 60 * 1000); // 7 days

    // 3. Get requester info
    const requesterId = newData.cancelled_by || newData.requested_by || null;
    let requester = null;
    if (requesterId) {
      try {
        const userResult = await query(
          `SELECT id, email, first_name, last_name,
           COALESCE(first_name || ' ' || last_name, email) as display_name
           FROM users
           WHERE id = $1 OR email = $1
           LIMIT 1`,
          [requesterId]
        );
        requester = userResult.rows[0];
      } catch (error) {
        logger.warn('Could not fetch requester details', { error: error.message });
      }
    }

    // 4. Process refund based on eligibility
    let refundResult = null;
    let refundStatus = 'pending_review';

    if (canAutoRefund) {
      logger.info('Auto-refund eligible, processing refund', { escrow_id: escrowId });
      
      try {
        // Get refund recipient (usually the funder)
        const refundToAddress = escrow.signer_address || requester?.id || null;
        const refundAmount = escrow.amount;

        if (refundToAddress) {
          refundResult = await blockchainService.processRefund(
            escrowId,
            escrow.contract_id,
            refundToAddress,
            refundAmount
          );

          // Update escrow refund status
          await escrowStateService.updateEscrowStatus(escrowId, 'CANCELLED', {
            metadata: {
              refund_tx_hash: refundResult.transactionHash,
              refund_processed_at: new Date().toISOString(),
              refund_reason: newData.cancellation_reason || 'Auto-refund',
            },
          });

          refundStatus = 'processed';
        } else {
          logger.warn('No refund address found', { escrow_id: escrowId });
          refundStatus = 'pending_review';
        }
      } catch (error) {
        logger.error('Error processing auto-refund', {
          error: error.message,
          escrow_id: escrowId,
        });
        refundStatus = 'failed';
      }
    } else {
      logger.info('Refund requires manual review', {
        escrow_id: escrowId,
        escrow_status: escrow.status,
      });
      refundStatus = 'pending_review';
    }

    // 5. Get participants to notify
    const participants = await escrowStateService.getParticipants(escrowId);

    // 6. Send refund notification to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'refund-requested',
          data: {
            participant_name: participant.display_name,
            escrow_id: escrow.id,
            refund_status: refundStatus,
            requested_by: requester?.display_name || 'System',
            transaction_hash: refundResult?.transactionHash || null,
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

    return res.json({
      success: true,
      message: 'Refund requested event processed',
      refund_status: refundStatus,
      auto_processed: canAutoRefund && refundResult !== null,
      transaction_hash: refundResult?.transactionHash || null,
    });
  } catch (error) {
    logger.error('Refund requested event error:', {
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      message: 'Event processing failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

module.exports = handleRefundRequested;
