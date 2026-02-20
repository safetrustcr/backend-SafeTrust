const { config } = require('../config');
const { logger } = require('../utils/logger');

/**
 * Service to interact with the external Trustless Work API.
 */
class TrustlessWorkService {
    constructor() {
        this.apiUrl = config.TRUSTLESS_WORK_API_URL;
        this.apiKey = config.TRUSTLESS_WORK_API_KEY;
    }

    /**
     * @param {string} contractId - The contract identifier.
     * @param {string} senderAddress - The address of the sender.
     * @param {string} amount - The amount to fund.
     * @returns {Promise<{ contractId: string, unsignedXdr: string }>}
     */
    async fundEscrow(contractId, senderAddress, amount) {
        try {
            const response = await fetch(`${this.apiUrl}/fund`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    contractId,
                    senderAddress,
                    amount
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Trustless Work API Error: ${response.status} ${errorText}`);
            }

            const data = await response.json();
            return data; // Expected { contractId, unsignedXdr }
        } catch (error) {
            logger.error('Failed to call Trustless Work API', { error: error.message, contractId });
            throw error;
        }
    }
}

module.exports = new TrustlessWorkService();
