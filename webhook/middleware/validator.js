/**
 * Input Validation Middleware
 * Validates request bodies using Joi schemas
 */

const Joi = require('joi');

// Validation schemas for different endpoints
const schemas = {
  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }).unknown(true), // Allow other fields for backward compatibility

  resetPassword: Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().min(8).required(),
  }).unknown(true),

  validateResetToken: Joi.object({
    token: Joi.string().required(),
  }),

  // Schema for Hasura Action format
  prepareEscrowContract: Joi.object({
    input: Joi.object({
      input: Joi.object({
        signer: Joi.string().required(),
        engagementId: Joi.string().uuid().required(),
        title: Joi.string().required(),
        description: Joi.string().allow(''),
        roles: Joi.array().items(Joi.object({
          address: Joi.string().required(),
          role: Joi.string().required(),
        })).required(),
        amount: Joi.number().positive().required(),
        platformFee: Joi.number().min(0).required(),
        milestones: Joi.array().items(Joi.object({
          description: Joi.string().required(),
          amount: Joi.number().positive().required(),
        })).min(1).required(),
        trustline: Joi.object({
          asset_code: Joi.string().required(),
          asset_issuer: Joi.string().required(),
        }).required(),
        receiverMemo: Joi.string().allow('').optional(),
      }).required(),
    }).required(),
    session_variables: Joi.object().optional(),
  }),

  // Generic Hasura webhook format
  hasuraWebhook: Joi.object({
    event: Joi.object({
      session_variables: Joi.object(),
      op: Joi.string().valid('INSERT', 'UPDATE', 'DELETE', 'MANUAL'),
      data: Joi.object({
        old: Joi.object().optional(),
        new: Joi.object().optional(),
      }).optional(),
    }).required(),
    created_at: Joi.string().isoDate().optional(),
    id: Joi.string().uuid().optional(),
    delivery_info: Joi.object().optional(),
    trigger: Joi.object().optional(),
    table: Joi.object().optional(),
  }),
};

/**
 * Creates a validation middleware for a specific schema
 * @param {string} schemaName - Name of the schema to validate against
 * @param {object} options - Validation options
 * @returns {Function} Express middleware function
 */
const validateRequest = (schemaName, options = {}) => {
  return (req, res, next) => {
    const schema = schemas[schemaName];

    if (!schema) {
      console.error(`Validation schema '${schemaName}' not found`);
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Determine what to validate based on route type
    let dataToValidate = req.body;

    // For query parameters (GET requests)
    if (req.method === 'GET' && Object.keys(req.query).length > 0) {
      dataToValidate = req.query;
    }

    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false, // Return all errors
      stripUnknown: options.stripUnknown || false,
      ...options,
    });

    if (error) {
      const errorDetails = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        error: 'Validation error',
        details: errorDetails,
      });
    }

    // Replace request body with validated value
    if (req.method === 'GET') {
      req.query = value;
    } else {
      req.body = value;
    }

    next();
  };
};

/**
 * Adds a custom schema
 * @param {string} name - Schema name
 * @param {object} schema - Joi schema
 */
const addSchema = (name, schema) => {
  schemas[name] = schema;
};

module.exports = {
  validateRequest,
  addSchema,
  schemas,
};
