const Joi = require('joi');
const trustlessWorkService = require('../services/trustless-work.service');
const { query } = require('../utils/database');
const { logger } = require('../utils/logger');

// Validation schema
const fundEscrowSchema = Joi.object({
    contractId: Joi.string().required(),
    senderAddress: Joi.string().required(),
    amount: Joi.string().pattern(/^\d+(\.\d+)?$/).required()
        .messages({ 'string.pattern.base': '"amount" must be a positive numeric string' }),

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
            'SELECT id, status, signer_address FROM escrow_transactions WHERE contract_id = $1',
            [contractId]
        );

        if (escrowResult.rows.length === 0) {
            return res.status(404).json({ error: 'Escrow contract not found' });
        }

        const escrow = escrowResult.rows[0];

        const NON_FUNDABLE = ['funded', 'funding', 'cancelled', 'completed'];
        if (NON_FUNDABLE.includes(escrow.status)) {
            return res.status(400).json({ error: `Escrow cannot be funded (status: ${escrow.status})` });
        }

        // Enforce ownership: ensure the caller is the designated funder
        if (escrow.signer_address !== senderAddress) {
            return res.status(403).json({ error: 'Forbidden: not a participant of this escrow' });
        }
        const originalStatus = escrow.status;

        // Atomically claim the row; prevents concurrent double-fund
        const claimResult = await query(
            `UPDATE escrow_transactions
             SET status = 'funding'
             WHERE id = $1 AND status NOT IN ('funded', 'funding', 'cancelled', 'completed')
             RETURNING id, contract_id`,
            [escrow.id]
        );

        if (claimResult.rows.length === 0) {
            return res.status(400).json({ error: 'Escrow cannot be funded in its current state' });
        }
        let apiResult;
        try {
            // 2. Call Trustless Work API only after DB claim succeeds
            apiResult = await trustlessWorkService.fundEscrow(contractId, senderAddress, amount);
        } catch (apiErr) {
            // Revert to previous status if external call fails
            await query(
                `UPDATE escrow_transactions SET status = $1 WHERE id = $2`,
                [originalStatus, escrow.id]
            );
            throw apiErr;
        }
        // 3. Confirm funded status in DB
        const updateResult = await query(
            `UPDATE escrow_transactions
             SET status = 'funded'
             WHERE id = $1
             RETURNING id, status, contract_id`,
            [escrow.id]
        );

        if (!updateResult.rows.length) {
            throw new Error('Escrow row disappeared after external funding call');
        }

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
