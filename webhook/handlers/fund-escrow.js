const Joi = require('joi');
const trustlessWorkService = require('../services/trustless-work.service');
const { query } = require('../utils/database');
const { logger } = require('../utils/logger');

// Validation schema
const fundEscrowSchema = Joi.object({
    contractId: Joi.string().required(),
    senderAddress: Joi.string().required(),
    amount: Joi.string().required() // Assuming string to preserve precision, or number
});

async function fundEscrowHandler(req, res) {
    const { error, value } = fundEscrowSchema.validate(req.body);
    if (error) {
        logger.warn('Fund Escrow Validation Error', { error: error.message });
        return res.status(400).json({ error: error.details[0].message });
    }

    const { contractId, senderAddress, amount } = value;

    try {
        // 1. Verify contract exists and is user participant
        const escrowResult = await query(
            'SELECT id, status FROM escrow_transactions WHERE contract_id = $1', // Assuming contract_id is the column
            [contractId]
        );

        if (escrowResult.rows.length === 0) {
            return res.status(404).json({ error: 'Escrow contract not found' });
        }

        const escrow = escrowResult.rows[0];


        if (escrow.status === 'funded') return res.status(400).json({ error: 'Already funded' });

        // 2. Call Trustless Work API
        const apiResult = await trustlessWorkService.fundEscrow(contractId, senderAddress, amount);

        // 3. Update status in DB
        const updateResult = await query(
            `UPDATE escrow_transactions 
       SET status = 'funded' 
       WHERE id = $1 
       RETURNING id, status, contract_id`,
            [escrow.id]
        );

        logger.info('Escrow Funded Successfully', {
            contractId,
            internalId: escrow.id,
            status: updateResult.rows[0].status
        });

        // 4. Return result
        return res.json({
            contractId: apiResult.contractId,
            unsignedXdr: apiResult.unsignedXdr
        });

    } catch (err) {
        logger.error('Fund Escrow Handler Error', { error: err.message, stack: err.stack });
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = fundEscrowHandler;
