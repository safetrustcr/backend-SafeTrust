const Joi = require("joi");
const { logger } = require("../utils/logger");

// UUID v4 validation schema
const uuidSchema = Joi.string().uuid({ version: "uuidv4" });

// Ethereum address validation (0x + 40 hex chars)
const addressSchema = Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/);

// Transaction hash validation (0x + 64 hex chars)
const txHashSchema = Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/);

// Signature validation (0x + 130 hex chars)
const signatureSchema = Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/);

/**
 * Validation schemas for different webhook endpoints
 */
const schemas = {
  // Escrow status update webhook
  escrowStatusUpdate: Joi.object({
    event: Joi.object({
      data: Joi.object({
        old: Joi.object({
          status: Joi.string().required(),
        }).unknown(true),
        new: Joi.object({
          status: Joi.string().required(),
        }).unknown(true),
      }).required(),
    }).required(),
  }),

  // Escrow refund status update webhook
  escrowRefundStatusUpdate: Joi.object({
    event: Joi.object({
      data: Joi.object({
        old: Joi.object({
          refund_status: Joi.string().required(),
        }).unknown(true),
        new: Joi.object({
          refund_status: Joi.string().required(),
        }).unknown(true),
      }).required(),
    }).required(),
  }),

  // Wallet verification action
  verifyWallet: Joi.object({
    input: Joi.object({
      user_id: uuidSchema.required(),
      wallet_address: addressSchema.required(),
      signature: signatureSchema.required(),
      message: Joi.string().max(500).required(),
    }).required(),
    session_variables: Joi.object().unknown(true),
  }),

  // Transaction verification action
  verifyTransaction: Joi.object({
    input: Joi.object({
      escrow_transaction_id: uuidSchema.required(),
      user_id: uuidSchema.required(),
      transaction_hash: txHashSchema.required(),
      wallet_address: addressSchema.required(),
    }).required(),
    session_variables: Joi.object().unknown(true),
  }),

  // Release funds action
  releaseFunds: Joi.object({
    input: Joi.object({
      escrow_transaction_id: uuidSchema.required(),
      admin_user_id: uuidSchema.required(),
      recipient_address: addressSchema.required(),
    }).required(),
    session_variables: Joi.object().unknown(true),
  }),
};

/**
 * Create validation middleware for a specific schema
 * @param {string} schemaName - Name of the schema to validate against
 * @returns {Function} Express middleware
 */
function validateRequest(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];

    if (!schema) {
      logger.error("Validation schema not found", { schemaName });
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false, 
      stripUnknown: true, 
    });

    if (error) {
      logger.warn("Request validation failed", {
        endpoint: req.path,
        schemaName,
        errors: error.details.map((d) => d.message),
      });

      return res.status(400).json({
        success: false,
        message: "Invalid request parameters",
        errors: error.details.map((d) => ({
          field: d.path.join("."),
          message: d.message,
        })),
      });
    }

    // Attach validated body to request
    req.validatedBody = value;
    next();
  };
}

module.exports = { validateRequest, schemas };
