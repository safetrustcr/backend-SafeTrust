const Joi = require("joi");
const { logger } = require("../utils/logger");

// Common validation patterns
const uuidSchema = Joi.string().uuid({ version: "uuidv4" });
const addressSchema = Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/);
const txHashSchema = Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/);
const signatureSchema = Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/);

/**
 * Validation schemas for different webhook endpoints
 */
const schemas = {
  // Auth related
  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }).unknown(true),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().min(8).required(),
  }).unknown(true),

  validateResetToken: Joi.object({
    token: Joi.string().required(),
  }),

  // Escrow related
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

  // Action related
  verifyWallet: Joi.object({
    input: Joi.object({
      user_id: uuidSchema.required(),
      wallet_address: addressSchema.required(),
      signature: signatureSchema.required(),
      message: Joi.string().max(500).required(),
    }).required(),
    session_variables: Joi.object().unknown(true),
  }),

  verifyTransaction: Joi.object({
    input: Joi.object({
      escrow_transaction_id: uuidSchema.required(),
      user_id: uuidSchema.required(),
      transaction_hash: txHashSchema.required(),
      wallet_address: addressSchema.required(),
    }).required(),
    session_variables: Joi.object().unknown(true),
  }),

  releaseFunds: Joi.object({
    input: Joi.object({
      escrow_transaction_id: uuidSchema.required(),
      admin_user_id: uuidSchema.required(),
      recipient_address: addressSchema.required(),
    }).required(),
    session_variables: Joi.object().unknown(true),
  }),

  prepareEscrowContract: Joi.object({
    input: Joi.object({
      input: Joi.object({
        signer: Joi.string().required(),
        engagementId: uuidSchema.required(),
        title: Joi.string().required(),
        description: Joi.string().allow(""),
        roles: Joi.array()
          .items(
            Joi.object({
              address: Joi.string().required(),
              role: Joi.string().required(),
            }),
          )
          .required(),
        amount: Joi.number().positive().required(),
        platformFee: Joi.number().min(0).required(),
        milestones: Joi.array()
          .items(
            Joi.object({
              description: Joi.string().required(),
              amount: Joi.number().positive().required(),
            }),
          )
          .min(1)
          .required(),
        trustline: Joi.object({
          asset_code: Joi.string().required(),
          asset_issuer: Joi.string().required(),
        }).required(),
        receiverMemo: Joi.string().allow("").optional(),
      }).required(),
    }).required(),
    session_variables: Joi.object().optional(),
  }),
};

/**
 * Validation middleware
 */
function validateRequest(schemaName, options = {}) {
  return (req, res, next) => {
    const schema = schemas[schemaName];

    if (!schema) {
      logger.error(`Validation schema '${schemaName}' not found`);
      return res.status(500).json({ error: "Internal server error" });
    }

    const dataToValidate =
      req.method === "GET" && Object.keys(req.query).length > 0
        ? req.query
        : req.body;

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false,
      stripUnknown:
        options.stripUnknown !== undefined ? options.stripUnknown : true,
      ...options,
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

    // Attach validated value
    if (req.method === "GET") {
      req.query = value;
    } else {
      req.body = value;
      req.validatedBody = value; // Keep for backward compatibility
    }

    next();
  };
}

module.exports = {
  validateRequest,
  schemas,
  addSchema: (name, schema) => {
    schemas[name] = schema;
  },
};
