const express = require('express');
const router = express.Router();

router.post('/escrow_refund_status_update', async (req, res) => {
    const { event } = req.body;
    const oldRefundStatus = event.data.old.refund_status;
    const newRefundStatus = event.data.new.refund_status;

    console.log(`Escrow refund status changed from ${oldRefundStatus} to ${newRefundStatus}`);

    res.status(200).json({ message: 'Webhook processed successfully' });
});

module.exports = router;
