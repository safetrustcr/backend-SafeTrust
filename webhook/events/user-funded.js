const { logger } = require('../utils/logger');
const { query } = require('../utils/database');
const notificationService = require('../services/notification.service');
const escrowStateService = require('../services/escrow-state.service');
const handleAllFunded = require('./all-funded');

/**
 * Handle user funded event
 * Triggered when escrow_transaction_users.funding_status changes to 'funded'
 * OR when escrow_transactions status indicates funding
 * 
 * Note: Adapt based on actual schema - this assumes escrow_transaction_users exists
 * If not, we'll need to track funding differently
 */
async function handleUserFunded(req, res) {
  const { event, table, trigger } = req.body;
  const { new: newData, old: oldData } = event.data;

  try {
    logger.info('User funded event received', {
      record_id: newData.id,
      escrow_id: newData.escrow_transaction_id || newData.id,
      user_id: newData.user_id || newData.user_email,
      funding_status: newData.funding_status,
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

    // 2. Get funding progress
    // Try to count funded users from escrow_transaction_users if table exists
    let fundedCount = 0;
    let totalParticipants = 0;

    try {
      const fundingResult = await query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN funding_status = 'funded' THEN 1 END) as funded
        FROM escrow_transaction_users
        WHERE escrow_transaction_id = $1`,
        [escrowId]
      );

      if (fundingResult.rows.length > 0) {
        totalParticipants = parseInt(fundingResult.rows[0].total) || 0;
        fundedCount = parseInt(fundingResult.rows[0].funded) || 0;
      }
    } catch (error) {
      // Table might not exist, use alternative logic
      logger.debug('Could not query escrow_transaction_users, using alternative method', {
        error: error.message,
      });
      // Assume funded if status changed
      fundedCount = 1;
      totalParticipants = 1;
    }

    // 3. Get user details for notification
    let user = null;
    try {
      const userId = newData.user_id || newData.user_email;
      const userResult = await query(
        `SELECT id, email, first_name, last_name,
         COALESCE(first_name || ' ' || last_name, email) as display_name
         FROM users
         WHERE id = $1 OR email = $1
         LIMIT 1`,
        [userId]
      );
      user = userResult.rows[0];
    } catch (error) {
      logger.warn('Could not fetch user details', { error: error.message });
    }

    const fundingPercentage = totalParticipants > 0
      ? Math.round((fundedCount / totalParticipants) * 100)
      : 100;

    // 4. Get all participants to notify
    const participants = await escrowStateService.getParticipants(escrowId);

    // 5. Send progress notification to all participants
    const notificationPromises = participants.map(async (participant) => {
      try {
        await notificationService.send({
          to: participant.email,
          template: 'funding-progress',
          data: {
            participant_name: participant.display_name,
            funded_by: user?.display_name || 'A participant',
            contract_id: escrow.contract_id,
            funded_count: fundedCount,
            total_participants: totalParticipants,
            percentage: fundingPercentage,
            remaining: totalParticipants - fundedCount,
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

    // 6. If all funded, trigger next event
    if (fundedCount === totalParticipants && totalParticipants > 0) {
      logger.info('All participants funded, triggering all_funded event', {
        escrow_id: escrowId,
      });

      // Call all_funded handler directly
      try {
        await handleAllFunded({
          body: {
            event: {
              data: { new: { id: escrowId } },
            },
          },
        }, { json: () => {}, status: () => ({ json: () => {} }) });
      } catch (error) {
        logger.error('Error triggering all_funded handler', {
          error: error.message,
          escrow_id: escrowId,
        });
      }
    }

    return res.json({
      success: true,
      message: 'User funded event processed',
      funding_progress: {
        funded: fundedCount,
        total: totalParticipants,
        percentage: fundingPercentage,
        complete: fundedCount === totalParticipants && totalParticipants > 0,
      },
    });
  } catch (error) {
    logger.error('User funded event error:', {
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

module.exports = handleUserFunded;
