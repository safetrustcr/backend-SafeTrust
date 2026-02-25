import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { logger } = require('../utils/logger');
const notificationService = require('../services/notification.service');
const { query } = require('../utils/database');

async function findCustomerByWallet(walletAddress) {
  if (!walletAddress) {
    return null;
  }

  const result = await query(
    `SELECT u.id AS user_id, u.email
     FROM user_wallets uw
     JOIN users u ON u.id = uw.user_id
     WHERE LOWER(uw.wallet_address) = LOWER($1)
     ORDER BY uw.is_primary DESC, uw.created_at ASC
     LIMIT 1`,
    [walletAddress]
  );

  return result.rows[0] || null;
}

export default async function escrowApprovalRequiredHandler(req, res) {
  const payload = req.body || {};
  const eventData = payload.event?.data || {};
  const newData = eventData.new || {};

  const escrowId = newData.escrow_id || newData.id;
  const customerWalletAddress = newData.customer_wallet_address;
  const oldValue = newData.old_value;
  const newValue = newData.new_value;

  try {
    logger.info('Escrow approval required event received', {
      trigger: payload.trigger?.name,
      escrow_id: escrowId,
      customer_wallet_address: customerWalletAddress,
    });

    let recipient = null;
    try {
      recipient = await findCustomerByWallet(customerWalletAddress);
    } catch (lookupError) {
      logger.warn('Customer lookup by wallet failed', {
        error: lookupError.message,
        escrow_id: escrowId,
        customer_wallet_address: customerWalletAddress,
      });
    }

    const notificationData = {
      escrow_id: escrowId,
      customer_wallet_address: customerWalletAddress,
      old_value: oldValue,
      new_value: newValue,
    };

    let emailResult = null;
    if (recipient?.email) {
      emailResult = await notificationService.send({
        to: recipient.email,
        template: 'escrow-approval-required',
        data: notificationData,
      });
    }

    const pushResult = await notificationService.sendPush({
      userId: recipient?.user_id || customerWalletAddress,
      title: 'Escrow approval required',
      body: `A superadmin updated escrow ${escrowId}. Please review and approve the change.`,
      data: notificationData,
    });

    logger.info('Escrow approval required event processed', {
      escrow_id: escrowId,
      customer_wallet_address: customerWalletAddress,
      recipient_user_id: recipient?.user_id,
      recipient_email: recipient?.email,
      email_sent: Boolean(emailResult?.success),
      push_sent: Boolean(pushResult?.success),
    });

    return res.status(200).json({
      success: true,
      message: 'Escrow approval notification processed',
      escrow_id: escrowId,
      customer_wallet_address: customerWalletAddress,
      notification: {
        email_sent: Boolean(emailResult?.success),
        push_sent: Boolean(pushResult?.success),
      },
    });
  } catch (error) {
    logger.error('Escrow approval required event error', {
      error: error.message,
      stack: error.stack,
      escrow_id: escrowId,
      customer_wallet_address: customerWalletAddress,
    });

    return res.status(500).json({
      success: false,
      message: 'Escrow approval notification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
