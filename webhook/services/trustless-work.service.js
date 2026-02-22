const axios = require('axios');
const { logger } = require('../utils/logger');

/**
 * Service for interacting with Trustless Work API
 * Handles escrow contract status and details retrieval
 */
class TrustlessWorkService {
  constructor() {
    this.baseUrl = process.env.TRUSTLESS_WORK_API_URL || 'https://api.trustlesswork.com';
    this.apiKey = process.env.TRUSTLESS_WORK_API_KEY;
    
    if (!this.apiKey) {
      logger.warn('TRUSTLESS_WORK_API_KEY not configured');
    }
  }

  /**
   * Get headers for Trustless Work API requests
   * @returns {Object} Request headers
   */
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
    };
  }

  /**
   * Get escrow contract status from Trustless Work API
   * @param {string} contractId - Contract ID
   * @returns {Promise<Object>} Escrow status details
   */
  async getEscrowStatus(contractId) {
    try {
      logger.info('Fetching escrow status from Trustless Work', { contractId });

      const response = await axios.get(
        `${this.baseUrl}/v1/escrow/${encodeURIComponent(contractId)}`,
        { headers: this.getHeaders(), timeout: 10000 }
      );

      logger.debug('Trustless Work API response', {
        contractId,
        status: response.status,
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error('Error fetching escrow status from Trustless Work', {
        contractId,
        error: error.message,
        status: error.response?.status,
      });

      // Return structured error
      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
          code: error.response?.data?.code || 'TRUSTLESS_WORK_ERROR',
        },
      };
    }
  }

  /**
   * Get transaction history for an escrow contract
   * @param {string} contractId - Contract ID
   * @returns {Promise<Object>} Transaction history
   */
  async getTransactionHistory(contractId) {
    try {
      logger.info('Fetching transaction history from Trustless Work', { contractId });

      const response = await axios.get(
        `${this.baseUrl}/v1/escrow/${encodeURIComponent(contractId)}/transactions`,
        { headers: this.getHeaders(), timeout: 10000 }
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error('Error fetching transaction history', {
        contractId,
        error: error.message,
      });

      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
        },
      };
    }
  }

  /**
   * Get milestone details for an escrow contract
   * @param {string} contractId - Contract ID
   * @returns {Promise<Object>} Milestone details
   */
  async getMilestones(contractId) {
    try {
      logger.info('Fetching milestones from Trustless Work', { contractId });

      const response = await axios.get(
        `${this.baseUrl}/v1/escrow/${encodeURIComponent(contractId)}/milestones`,
        { headers: this.getHeaders(), timeout: 10000 }
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error('Error fetching milestones', {
        contractId,
        error: error.message,
      });

      return {
        success: false,
        error: {
          message: error.response?.data?.message || error.message,
          status: error.response?.status || 500,
        },
      };
    }
  }
}

module.exports = new TrustlessWorkService();
