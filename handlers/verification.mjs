import { GraphQLClient } from "graphql-request";
import express from "express";

// Summary: Creates a GraphQL client to interact with the Hasura GraphQL API.
const hasuraClient = new GraphQLClient("http://localhost:8080/v1/graphql", {
  headers: {
    // Add custom headers if needed
  },
});

const app = express();
app.use(express.json());

// Summary: Generates a 6-digit random verification code.
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Summary: Handles the endpoint to send a verification code to the user's email.
 *
 * Details:
 * - Generates a verification code and expiration time.
 * - Updates the user's `verification_code` and `verification_code_expires_at` fields in the database.
 * - Returns a success message if the operation is successful.
 *
 * Request Body Structure:
 * {
 *   "input": {
 *     "input": {
 *       "email": "user@exa.com"
 *     }
 *   }
 * }
 *
 * Response:
 * - Success: { success: true, message: "Verification code sent", expiresAt: "timestamp" }
 * - Failure: { success: false, message: "Failed to send verification code" }
 */
app.post("/send-verification", async (req, res) => {
  const email = req.body.input?.input?.email;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60000); // Code expires in 15 minutes

  const mutation = `
    mutation UpdateVerificationCode($email: String!, $code: String!, $expiresAt: timestamptz!) {
      update_users(
        where: { email: { _eq: $email } },
        _set: {
          verification_code: $code,
          verification_code_expires_at: $expiresAt,
          verification_attempts: 0
        }
      ) {
        affected_rows
      }
    }
  `;

  try {
    await hasuraClient.request(mutation, { email, code, expiresAt });
    res.json({
      success: true,
      message: "Verification code sent",
      expiresAt,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({
      success: false,
      message: "Failed to send verification code",
    });
  }
});

/**
 * Summary: Handles the endpoint to verify the user's email using a code.
 *
 * Details:
 * - Validates that the email and verification code are provided.
 * - Checks if the provided code matches the database record and is not expired.
 * - Updates the user's `is_email_verified` field to `true` if verification succeeds.
 * - Returns appropriate success or failure messages.
 *
 * Request Body Structure:
 * {
 *   "input": {
 *     "input": {
 *       "email": "user@exa.com",
 *       "code": "123456"
 *     }
 *   }
 * }
 *
 * Response:
 * - Success: { success: true, message: "Email verified successfully" }
 * - Failure: { success: false, message: "Invalid or expired verification code" }
 */
app.post("/verify-code", async (req, res) => {

  const email = req.body.input?.input?.email;
  const code = req.body.input?.input?.code;

  if (!email || !code) {
    return res.status(400).json({
      success: false,
      message: "Email and code are required",
    });
  }

  const mutation = `
    mutation VerifyCode($email: String!, $code: String!) {
      update_users(
        where: {
          email: { _eq: $email },
          verification_code: { _eq: $code },
          verification_code_expires_at: { _gt: "now()" }
        },
        _set: {
          is_email_verified: true,
          verification_code: null,
          verification_code_expires_at: null
        }
      ) {
        affected_rows
      }
    }
  `;

  try {
    const result = await hasuraClient.request(mutation, { email, code });

    if (result.update_users.affected_rows > 0) {
      res.json({
        success: true,
        message: "Email verified successfully",
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
});

/**
 * Summary: Starts the server to handle API requests.
 *
 * Details:
 * - Listens on port 3000 and binds to all network interfaces (0.0.0.0).
 * - Logs a message when the server is running.
 */
app.listen(3000, '0.0.0.0', () => {
  console.log("Verification server running on http://0.0.0.0:3000");
});
