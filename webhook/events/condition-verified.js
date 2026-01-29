const { logger } = require('../utils/logger');
const escrowStateService = require('../services/escrow-state.service');
const notificationService = require('../services/notification.service');
const handleAllConditionsMet = require('./all-conditions-met');

/**
 * Handle condition verified event
 * Triggered when escrow_milestones.status changes to 'approved' or 'verified'
 * 
 * Note: Using escrow_milestones instead of escrow_conditions as per codebase
 */
async function handleConditionVerified(req, res) {
  const { event, table, trigger } = req.body;
  const { new: newData, old: oldData } = event.data;

  try {
    logger.info('Condition verified event received', {
      milestone_id: newData.id,
      escrow_id: newData.escrow_id,
      status: newData.status,
    });

    const escrowId = newData.escrow_id;

    // 1. Get escrow details
    const escrow = await escrowStateService.getEscrow(escrowId);
    if (!escrow) {
      // Try to get from trustless_work_escrows if escrow_id points there
      logger.debug('Escrow not found in escrow_transactions, checking trustless_work_escrows', {
        escrow_id: escrowId,
      });
    }

    // 2. Get all milestones for this escrow
    const conditionCheck = await escrowStateService.checkAllConditionsMet(escrowId);
    
    const { total, verified, milestones } = conditionCheck;
    const verificationPercentage = total > 0 ? Math.round((verified / total) * 100) : 100;

    // 3. Get participants to notify
    const participants = await escrowStateService.getParticipants(escrowId);

    // 4. Get milestone details for notification
    const milestone = milestones?.find(m => m.id === newData.id) || newData;

    // 5. Send progress notification to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'condition-verified',
          data: {
            participant_name: participant.display_name,
            escrow_id: escrowId,
            condition_description: milestone.description || milestone.milestone_id || 'Condition',
            verified_count: verified,
            total_conditions: total,
            percentage: verificationPercentage,
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

    // 6. If all conditions met, trigger fund release check
    if (conditionCheck.allMet && total > 0) {
      logger.info('All conditions met, triggering fund release check', {
        escrow_id: escrowId,
      });

      try {
        await handleAllConditionsMet({
          body: {
            event: {
              data: { new: { id: escrowId } },
            },
          },
        }, { json: () => {}, status: () => ({ json: () => {} }) });
      } catch (error) {
        logger.error('Error triggering all_conditions_met handler', {
          error: error.message,
          escrow_id: escrowId,
        });
      }
    }

    return res.json({
      success: true,
      message: 'Condition verified event processed',
      condition_status: {
        verified,
        total,
        percentage: verificationPercentage,
        all_met: conditionCheck.allMet,
      },
    });
  } catch (error) {
    logger.error('Condition verified event error:', {
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

module.exports = handleConditionVerified;
