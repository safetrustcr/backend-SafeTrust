const { query } = require('../utils/database');
const { logger } = require('../utils/logger');

/**
 * Service for managing escrow state transitions and queries
 */
class EscrowStateService {
  /**
   * Get escrow details by ID
   * @param {string} escrowId - Escrow transaction ID
   * @returns {Promise<Object|null>} Escrow details
   */
  async getEscrow(escrowId) {
    try {
      const result = await query(
        `SELECT 
          id,
          bid_request_id,
          engagement_id,
          contract_id,
          signer_address,
          transaction_type,
          status,
          amount,
          initial_deposit_percentage,
          metadata,
          created_at,
          updated_at,
          completed_at
        FROM escrow_transactions
        WHERE id = $1`,
        [escrowId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error getting escrow:', { error: error.message, escrowId });
      throw error;
    }
  }

  /**
   * Update escrow status
   * @param {string} escrowId - Escrow transaction ID
   * @param {string} status - New status
   * @param {Object} additionalData - Additional fields to update
   * @returns {Promise<Object>} Updated escrow
   */
  async updateEscrowStatus(escrowId, status, additionalData = {}) {
    try {
      const updateFields = ['status = $2', 'updated_at = NOW()'];
      const values = [escrowId, status];
      let paramIndex = 3;

      if (additionalData.completed_at) {
        updateFields.push(`completed_at = $${paramIndex}`);
        values.push(additionalData.completed_at);
        paramIndex++;
      }

      if (additionalData.metadata) {
        updateFields.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIndex}::jsonb`);
        values.push(JSON.stringify(additionalData.metadata));
        paramIndex++;
      }

      const result = await query(
        `UPDATE escrow_transactions
        SET ${updateFields.join(', ')}
        WHERE id = $1
        RETURNING *`,
        values
      );

      logger.info(`Escrow status updated: ${escrowId} -> ${status}`);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating escrow status:', { error: error.message, escrowId, status });
      throw error;
    }
  }

  /**
   * Get funding progress for an escrow
   * Note: This assumes funding is tracked via escrow_transaction_users or similar
   * Adapt based on actual schema
   * @param {string} escrowId - Escrow transaction ID
   * @returns {Promise<Object>} Funding progress
   */
  async getFundingProgress(escrowId) {
    try {
      // Try to get funding info from escrow_transaction_users if it exists
      // Otherwise, check if escrow has been funded based on status
      const escrow = await this.getEscrow(escrowId);
      
      // For now, return basic info - adapt based on actual schema
      return {
        escrow_id: escrowId,
        status: escrow?.status,
        funded: escrow?.status !== 'PENDING',
        // TODO: Add actual funding count logic when schema is confirmed
      };
    } catch (error) {
      logger.error('Error getting funding progress:', { error: error.message, escrowId });
      throw error;
    }
  }

  /**
   * Get all milestones for an escrow
   * @param {string} escrowId - Escrow transaction ID (or contract_id)
   * @returns {Promise<Array>} List of milestones
   */
  async getMilestones(escrowId) {
    try {
      // Try to get milestones from escrow_milestones table
      // First, try to find the trustless_work_escrows record
      const result = await query(
        `SELECT 
          em.id,
          em.escrow_id,
          em.milestone_id,
          em.description,
          em.amount,
          em.due_date,
          em.status,
          em.approved_at,
          em.approved_by,
          em.released_at,
          em.released_by,
          em.metadata
        FROM escrow_milestones em
        JOIN trustless_work_escrows twe ON em.escrow_id = twe.id
        WHERE twe.contract_id = $1 OR em.escrow_id::text = $1
        ORDER BY em.created_at`,
        [escrowId]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting milestones:', { error: error.message, escrowId });
      // If table doesn't exist or query fails, return empty array
      return [];
    }
  }

  /**
   * Check if all milestones are approved/verified
   * @param {string} escrowId - Escrow transaction ID
   * @returns {Promise<Object>} Condition check result
   */
  async checkAllConditionsMet(escrowId) {
    try {
      const milestones = await this.getMilestones(escrowId);
      
      if (milestones.length === 0) {
        // No milestones means conditions are met (or not using milestone system)
        return { allMet: true, total: 0, verified: 0 };
      }

      const verified = milestones.filter(m => 
        m.status === 'approved' || m.status === 'released'
      );

      return {
        allMet: verified.length === milestones.length,
        total: milestones.length,
        verified: verified.length,
        milestones,
      };
    } catch (error) {
      logger.error('Error checking conditions:', { error: error.message, escrowId });
      throw error;
    }
  }

  /**
   * Get participants for an escrow
   * Note: Adapt based on actual schema
   * @param {string} escrowId - Escrow transaction ID
   * @returns {Promise<Array>} List of participants
   */
  async getParticipants(escrowId) {
    try {
      // Try escrow_transaction_users if it exists
      // Otherwise, get from bid_request or other source
      const result = await query(
        `SELECT DISTINCT
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          COALESCE(u.first_name || ' ' || u.last_name, u.email) as display_name
        FROM users u
        JOIN bid_requests br ON (br.landlord_id = u.id OR br.tenant_id = u.id)
        JOIN escrow_transactions et ON et.bid_request_id = br.id
        WHERE et.id = $1
        UNION
        SELECT DISTINCT
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          COALESCE(u.first_name || ' ' || u.last_name, u.email) as display_name
        FROM users u
        WHERE u.id IN (
          SELECT DISTINCT signer_address FROM escrow_transactions WHERE id = $1
        )`,
        [escrowId]
      );

      return result.rows;
    } catch (error) {
      logger.error('Error getting participants:', { error: error.message, escrowId });
      // Return empty array if query fails
      return [];
    }
  }
}

module.exports = new EscrowStateService();
