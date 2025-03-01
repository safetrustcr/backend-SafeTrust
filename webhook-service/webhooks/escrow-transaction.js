const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { logger } = require('../config/logger');

// Configure database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Authentication middleware
const authenticateWebhook = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.WEBHOOK_SECRET;

  logger.info('Auth debug', {
    receivedHeader: authHeader,
    expectedSecret: expectedSecret
  });

  if (!authHeader || authHeader !== expectedSecret) {
    logger.error('Authentication failed for webhook request', {
      requestId: req.headers['x-hasura-event-id'],
      error: 'Invalid or missing authorization header'
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Idempotency check middleware
const checkIdempotency = async (req, res, next) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  
  if (!idempotencyKey) {
    logger.warn('Missing idempotency key', {
      requestId: req.headers['x-hasura-event-id']
    });
    return next();
  }

  try {
    const result = await pool.query(
      'SELECT id FROM webhook_processed_events WHERE event_id = $1',
      [idempotencyKey]
    );
    
    if (result.rows.length > 0) {
      logger.info('Duplicate event detected, skipping processing', {
        eventId: idempotencyKey
      });
      return res.status(200).json({ message: 'Event already processed' });
    }
    
    next();
  } catch (error) {
    logger.error('Error checking idempotency', {
      eventId: idempotencyKey,
      error: error.message
    });
    next();
  }
};

// Record processed event
const recordProcessedEvent = async (eventId, status, details) => {
  try {
    await pool.query(
      'INSERT INTO webhook_processed_events (event_id, status, details, processed_at) VALUES ($1, $2, $3, NOW())',
      [eventId, status, JSON.stringify(details)]
    );
  } catch (error) {
    logger.error('Failed to record processed event', {
      eventId,
      error: error.message
    });
  }
};

// Update escrow transaction with webhook response
const updateEscrowTransaction = async (id, status, responseData) => {
  try {
    await pool.query(
      'UPDATE escrow_transactions SET http_status_code = $1, http_response_body = $2, updated_at = NOW() WHERE id = $3',
      [status, responseData, id]
    );
  } catch (error) {
    logger.error('Failed to update escrow transaction', {
      transactionId: id,
      error: error.message
    });
  }
};

// Main webhook handler
router.post('/escrow-transaction', authenticateWebhook, checkIdempotency, async (req, res) => {
  const eventId = req.headers['x-hasura-event-id'] || 'unknown';
  const eventData = req.body;
  
  logger.info('Received escrow transaction webhook', {
    eventId,
    operation: eventData.event?.op,
    table: eventData.table?.name,
    transactionId: eventData.event?.data?.new?.id
  });

  try {
    // Process based on operation type
    const operation = eventData.event?.op;
    const transactionData = operation === 'DELETE' ? eventData.event?.data?.old : eventData.event?.data?.new;
    
    if (!transactionData || !transactionData.id) {
      throw new Error('Invalid transaction data received');
    }

    // Process the transaction based on its type and status
    const transactionType = transactionData.transaction_type;
    const status = transactionData.status;
    
    // Example processing logic - customize based on your requirements
    let processingResult;
    
    switch (operation) {
      case 'INSERT':
        processingResult = await handleNewTransaction(transactionData);
        break;
      case 'UPDATE':
        processingResult = await handleUpdatedTransaction(transactionData, eventData.event?.data?.old);
        break;
      case 'DELETE':
        processingResult = await handleDeletedTransaction(transactionData);
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
    
    // Record the processed event
    await recordProcessedEvent(eventId, 'success', {
      transactionId: transactionData.id,
      result: processingResult
    });
    
    // Update the transaction with response data
    await updateEscrowTransaction(
      transactionData.id, 
      200, 
      { processed: true, result: processingResult }
    );
    
    logger.info('Successfully processed escrow transaction webhook', {
      eventId,
      transactionId: transactionData.id,
      result: processingResult
    });
    
    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      data: processingResult
    });
    
  } catch (error) {
    logger.error('Error processing escrow transaction webhook', {
      eventId,
      error: error.message,
      stack: error.stack
    });
    
    // Record the failed event
    await recordProcessedEvent(eventId, 'error', {
      error: error.message,
      stack: error.stack
    });
    
    // For certain errors, we might want to return a 4xx status to prevent retries
    const isClientError = error.message.includes('Invalid') || error.message.includes('Unsupported');
    
    if (isClientError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook data',
        error: error.message
      });
    }
    
    // For server errors, return 500 to trigger retry mechanism
    return res.status(500).json({
      success: false,
      message: 'Internal server error processing webhook',
      error: error.message
    });
  }
});

// Transaction handling functions
async function handleNewTransaction(transactionData) {
  logger.info('Processing new escrow transaction', {
    transactionId: transactionData.id,
    type: transactionData.transaction_type
  });
  
  return {
    status: 'processed',
    message: `New ${transactionData.transaction_type} transaction processed`
  };
}

async function handleUpdatedTransaction(newData, oldData) {
  logger.info('Processing updated escrow transaction', {
    transactionId: newData.id,
    oldStatus: oldData.status,
    newStatus: newData.status
  });
  
  return {
    status: 'updated',
    message: `Transaction status changed from ${oldData.status} to ${newData.status}`
  };
}

async function handleDeletedTransaction(transactionData) {
  logger.info('Processing deleted escrow transaction', {
    transactionId: transactionData.id
  });
  
  return {
    status: 'deleted',
    message: 'Transaction deletion processed'
  };
}

module.exports = router; 