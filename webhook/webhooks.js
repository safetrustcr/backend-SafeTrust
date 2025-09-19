const express = require('express');
const router = express.Router();
const forgotPasswordRouter = require('./forgot-password');
const firebaseWebhooksRouter = require('./firebase-webhooks');

// Include forgot password routes
router.use('/', forgotPasswordRouter);

// Include Firebase webhook routes
router.use('/firebase', firebaseWebhooksRouter);

router.post('/escrow_refund_status_update', async (req, res) => {
    console.log("escrow_refund_status_update");
    const { event } = req.body;
    const oldRefundStatus = event.data.old.refund_status;
    const newRefundStatus = event.data.new.refund_status;

    console.log(`Escrow refund status changed from ${oldRefundStatus} to ${newRefundStatus}`);

    res.status(200).json({ message: 'Webhook processed successfully' });
});

router.post('/escrow_status_update', async (req, res) => {
    console.log("escrow_status_update");
    const { event } = req.body;
    const oldStatus = event.data.old.status;
    const newStatus = event.data.new.status;

    console.log(`Escrow status changed from ${oldStatus} to ${newStatus}`);

    res.status(200).json({ message: 'Webhook processed successfully' });
});

module.exports = router;
