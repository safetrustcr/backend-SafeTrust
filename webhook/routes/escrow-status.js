const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
const { query } = require('../utils/database');
const trustlessWorkService = require('../services/trustless-work.service');
const escrowStateService = require('../services/escrow-state.service');
const { asyncHandler } = require('../middleware/error-handler');

/**
 * GET /api/escrow/status/:contractId
 * Retrieve complete status and details of a given escrow contract
 * 
 * Requirements:
 * - JWT authentication required
 * - Validates contractId from route parameter
 * - Queries Trustless Work API for escrow status
 * - Queries Hasura GraphQL DB for local metadata
 * - Combines and returns comprehensive escrow information
 */
router.get('/status/:contractId', asyncHandler(async (req, res) => {
  const { contractId } = req.params;

  // Validate contractId
  if (!contractId || contractId.trim() === '') {
    logger.warn('Missing contractId in request', { endpoint: req.path });
    return res.status(400).json({
      success: false,
      message: 'Contract ID is required',
      code: 'VALIDATION_ERROR',
    });
  }

  logger.info('Fetching escrow status', {
    contractId,
    userId: req.user?.userId,
    role: req.user?.role,
  });

  try {
    // 1. Query local database for escrow transaction details
    const localEscrowQuery = await query(
      `SELECT 
        et.id,
        et.bid_request_id,
        et.engagement_id,
        et.contract_id,
        et.signer_address,
        et.transaction_type,
        et.status as local_status,
        et.amount,
        et.initial_deposit_percentage,
        et.metadata,
        et.created_at,
        et.updated_at,
        et.completed_at,
        et.escrow_payload
      FROM escrow_transactions et
      WHERE et.contract_id = $1
      LIMIT 1`,
      [contractId]
    );

    const localEscrow = localEscrowQuery.rows[0];

    if (!localEscrow) {
      logger.warn('Escrow not found in local database', { contractId });
      return res.status(404).json({
        success: false,
        message: 'Escrow contract not found',
        code: 'NOT_FOUND',
      });
    }

    // 2. Get participants/parties information
    const participantsQuery = await query(
      `SELECT DISTINCT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) as display_name,
        br.landlord_id,
        br.tenant_id
      FROM users u
      LEFT JOIN bid_requests br ON (br.landlord_id = u.id OR br.tenant_id = u.id)
      LEFT JOIN escrow_transactions et ON et.bid_request_id = br.id
      WHERE et.contract_id = $1`,
      [contractId]
    );

    const participants = participantsQuery.rows;

    // 3. Get property/apartment details if available
    let propertyDetails = null;
    try {
      const propertyQuery = await query(
        `SELECT 
          a.id,
          a.title,
          a.address,
          a.city,
          a.state,
          a.zip_code,
          a.monthly_rent,
          a.security_deposit
        FROM apartments a
        JOIN bid_requests br ON br.apartment_id = a.id
        JOIN escrow_transactions et ON et.bid_request_id = br.id
        WHERE et.contract_id = $1
        LIMIT 1`,
        [contractId]
      );

      if (propertyQuery.rows.length > 0) {
        propertyDetails = propertyQuery.rows[0];
      }
    } catch (error) {
      logger.warn('Failed to fetch property details', { 
        contractId, 
        error: error.message 
      });
    }

    // 4. Get milestones from local database
    const milestones = await escrowStateService.getMilestones(contractId);

    // 5. Get API call history (if table exists)
    let apiCallHistory = [];
    try {
      const apiCallsQuery = await query(
        `SELECT 
          id,
          api_endpoint,
          request_method,
          response_status,
          created_at
        FROM escrow_api_calls
        WHERE contract_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
        [contractId]
      );

      apiCallHistory = apiCallsQuery.rows;
    } catch (error) {
      logger.warn('Failed to fetch API call history', { 
        contractId, 
        error: error.message 
      });
      // Table might not exist yet, continue with empty array
    }

    // 6. Query Trustless Work API for external status
    const trustlessWorkStatus = await trustlessWorkService.getEscrowStatus(contractId);
    
    let externalStatus = null;
    let externalError = null;

    if (trustlessWorkStatus.success) {
      externalStatus = trustlessWorkStatus.data;
    } else {
      externalError = trustlessWorkStatus.error;
      logger.warn('Failed to fetch Trustless Work status', {
        contractId,
        error: externalError,
      });
    }

    // 7. Get transaction history from Trustless Work API
    let transactionHistory = [];
    const txHistory = await trustlessWorkService.getTransactionHistory(contractId);
    if (txHistory.success) {
      transactionHistory = txHistory.data?.transactions || [];
    }

    // 8. Combine all data into comprehensive response
    const response = {
      success: true,
      data: {
        // Local database information
        local: {
          id: localEscrow.id,
          contract_id: localEscrow.contract_id,
          status: localEscrow.local_status,
          transaction_type: localEscrow.transaction_type,
          amount: localEscrow.amount,
          initial_deposit_percentage: localEscrow.initial_deposit_percentage,
          signer_address: localEscrow.signer_address,
          engagement_id: localEscrow.engagement_id,
          bid_request_id: localEscrow.bid_request_id,
          metadata: localEscrow.metadata,
          escrow_payload: localEscrow.escrow_payload,
          created_at: localEscrow.created_at,
          updated_at: localEscrow.updated_at,
          completed_at: localEscrow.completed_at,
        },

        // Trustless Work API information
        external: externalStatus ? {
          status: externalStatus.status,
          contract_address: externalStatus.contract_address,
          blockchain_status: externalStatus.blockchain_status,
          funded_amount: externalStatus.funded_amount,
          released_amount: externalStatus.released_amount,
          last_updated: externalStatus.last_updated,
        } : null,

        // External API error if any
        external_error: externalError,

        // Parties involved
        parties: participants.map(p => ({
          id: p.id,
          email: p.email,
          name: p.display_name,
          first_name: p.first_name,
          last_name: p.last_name,
          role: p.id === p.landlord_id ? 'landlord' : 
                p.id === p.tenant_id ? 'tenant' : 'participant',
        })),

        // Property details
        property: propertyDetails,

        // Milestones
        milestones: milestones.map(m => ({
          id: m.id,
          milestone_id: m.milestone_id,
          description: m.description,
          amount: m.amount,
          status: m.status,
          due_date: m.due_date,
          approved_at: m.approved_at,
          released_at: m.released_at,
        })),

        // Transaction history
        transaction_history: transactionHistory,

        // API call history
        api_call_history: apiCallHistory,

        // Sync status
        sync_status: {
          local_available: true,
          external_available: trustlessWorkStatus.success,
          synced: trustlessWorkStatus.success && 
                  externalStatus?.status?.toLowerCase() === localEscrow.local_status?.toLowerCase(),
          last_checked: new Date().toISOString(),
        },
      },
    };

    logger.info('Escrow status retrieved successfully', {
      contractId,
      local_status: localEscrow.local_status,
      external_status: externalStatus?.status,
      synced: response.data.sync_status.synced,
    });

    return res.json(response);

  } catch (error) {
    logger.error('Error retrieving escrow status', {
      contractId,
      error: error.message,
      stack: error.stack,
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve escrow status',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}));

module.exports = router;
