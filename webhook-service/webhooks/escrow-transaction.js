const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const winston = require('winston');
const config = require('../config/webhook');

// Configure database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'escrow-transaction-webhook' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/escrow-webhook-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/escrow-webhook.log' })
  ],
});

// Authentication middleware
const authenticateWebhook = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!authHeader || authHeader !== expectedSecret) {
    logger.error('Authentication failed for webhook request', {
      requestId: req.headers['x-hasura-event-id'],
      error: 'Invalid or missing authorization header'
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Idempotency check middleware using escrow_transactions table
const checkIdempotency = async (req, res, next) => {
  const eventId = req.headers['x-idempotency-key'] || req.headers['x-hasura-event-id'];
  
  if (!eventId) {
    logger.warn('Missing idempotency key', {
      requestId: req.headers['x-hasura-event-id']
    });
    return next();
  }

  try {
    // Get transaction ID from request body
    const eventData = req.body;
    const operation = eventData.event?.op;
    const transactionData = operation === 'DELETE' ? eventData.event?.data?.old : eventData.event?.data?.new;
    
    if (!transactionData || !transactionData.id) {
      logger.warn('Missing transaction ID in event payload', {
        eventId: eventId
      });
      return next();
    }

    // Check if this transaction has already processed this event ID
    const result = await pool.query(
      `SELECT id, webhook_status, webhook_attempts 
       FROM escrow_transactions 
       WHERE id = $1 AND http_response_body->>'eventId' = $2`,
      [transactionData.id, eventId]
    );
    
    if (result.rows.length > 0) {
      logger.info('Duplicate event detected, skipping processing', {
        eventId: eventId,
        transactionId: transactionData.id
      });
      return res.status(200).json({ message: 'Event already processed', eventId: eventId });
    }
    
    next();
  } catch (error) {
    logger.error('Error checking idempotency', {
      eventId: eventId,
      error: error.message
    });
    next();
  }
};

// Update escrow transaction with webhook response
const updateTransactionWithResponse = async (id, status, responseData, eventId) => {
  try {
    await pool.query(
      `UPDATE escrow_transactions 
       SET http_status_code = $1, 
           http_response_body = $2, 
           webhook_status = $3,
           webhook_attempts = COALESCE(webhook_attempts, 0) + 1,
           last_webhook_attempt = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [status, JSON.stringify({ ...responseData, eventId }), 
       status >= 200 && status < 300 ? 'success' : 'failed', id]
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
    transactionId: eventData.event?.data?.new?.id || eventData.event?.data?.old?.id
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
    
    // Update the transaction with response data
    await updateTransactionWithResponse(
      transactionData.id, 
      200, 
      { processed: true, result: processingResult },
      eventId
    );
    
    logger.info('Successfully processed escrow transaction webhook', {
      eventId,
      transactionId: transactionData.id,
      result: processingResult
    });
    
    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      data: processingResult,
      eventId: eventId
    });
    
  } catch (error) {
    logger.error('Error processing escrow transaction webhook', {
      eventId,
      error: error.message,
      stack: error.stack
    });
    
    // For certain errors, we might want to return a 4xx status to prevent retries
    const isClientError = error.message.includes('Invalid') || error.message.includes('Unsupported');
    const statusCode = isClientError ? 400 : 500;
    
    // If we can extract the transaction ID, update it with the error details
    try {
      const operation = req.body.event?.op;
      const transactionData = operation === 'DELETE' ? req.body.event?.data?.old : req.body.event?.data?.new;
      
      if (transactionData && transactionData.id) {
        await updateTransactionWithResponse(
          transactionData.id,
          statusCode,
          { success: false, error: error.message },
          eventId
        );
      }
    } catch (updateError) {
      logger.error('Failed to update transaction with error details', {
        error: updateError.message
      });
    }
    
    // Return error response
    return res.status(statusCode).json({
      success: false,
      message: isClientError ? 'Invalid webhook data' : 'Internal server error processing webhook',
      error: error.message,
      eventId: eventId
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