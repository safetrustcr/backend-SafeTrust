import { GraphQLClient } from "graphql-request";
import express from "express";
import cors from "cors";
import transporter from "./emailConfig.mjs";
import rateLimit from "express-rate-limit"; 

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 5, 
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});

const hasuraClient = new GraphQLClient("http://localhost:8080/v1/graphql", {
  headers: {
  },
});

const app = express();
app.use(express.json());

// Summary: Generates a 6-digit random verification code.
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Summary: Sends a verification code to the provided email.
 *
 * Details:
 * - Validates the email input in the request.
 * - Generates a 6-digit verification code with a 15-minute expiration.
 * - Updates the user's verification code and expiration time in the database.
 * - Sends the verification code via email.
 * - Logs events and errors to the database.
 *
 * Response:
 * - Success: Sends the verification code and expiration time.
 * - Failure: Provides error messages for invalid input or failed operations.
 */

app.post("/send-verification", limiter, async (req, res) => {
  const email = req.body.input?.input?.email;

  if (!email) {
    await logToDatabase("warn", "Email is missing in the request body", { requestBody: req.body });
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60000);

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
    const response = await hasuraClient.request(mutation, { email, code, expiresAt });

    if (response.update_users.affected_rows === 0) {
      await logToDatabase("warn", "No users were updated with the verification code", { email });
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const mailOptions = {
      from: "Safetrust <your_email@gmail.com>",
      to: email,
      subject: "Verification Code",
      text: `Your verification code is: ${code}`,
    };

    await transporter.sendMail(mailOptions);

    await logToDatabase("info", "Verification code sent successfully", { email, code, expiresAt });

    return res.json({
      success: true,
      message: "Verification code sent",
      expiresAt,
    });
  } catch (error) {
    await logToDatabase("error", "Error sending verification code", { error: error.message, email });

    console.error("Error in send-verification:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send verification code",
    });
  }
});


/**
 * Summary: Verifies the user's email using a provided verification code.
 *
 * Details:
 * - Validates the presence of email and verification code in the request.
 * - Increments verification attempts and logs the timestamp of the request.
 * - Checks the database to validate the verification code and expiration.
 * - Marks the user's email as verified if the code is valid and not expired.
 * - Logs events such as successful verification, invalid codes, and errors to the database.
 *
 * Response:
 * - Success: Confirms email verification and updates the user's status.
 * - Failure: Provides error messages for missing input, invalid codes, or system errors.
 */

app.post("/verify-code", limiter, async (req, res) => {
  const email = req.body.input?.input?.email;
  const code = req.body.input?.input?.code;

  if (!email || !code) {
    await logToDatabase("warn", "Missing email or code in /verify-code request", {});
    return res.status(400).json({
      success: false,
      message: "Email and code are required",
    });
  }

  const updateAttemptsMutation = `
    mutation IncrementVerificationAttempts($email: String!) {
      update_users(
        where: { email: { _eq: $email } },
        _inc: { verification_attempts: 1 },
        _set: { last_verification_request: "now()" }
      ) {
        affected_rows
      }
    }
  `;

  const verifyCodeMutation = `
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

    await hasuraClient.request(updateAttemptsMutation, { email });

    const result = await hasuraClient.request(verifyCodeMutation, { email, code });

    if (result.update_users.affected_rows > 0) {
      await logToDatabase("info", `Email verified successfully for ${email}`, {});
      return res.json({
        success: true,
        message: "Email verified successfully",
      });
    } else {
      await logToDatabase("warn", `Invalid or expired verification code for ${email}`, {});
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code",
      });
    }
  } catch (error) {
    await logToDatabase("error", "Failed to verify email", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
});

/**
 * Summary: Logs messages and details to the database.
 *
 * Details:
 * - Inserts a log entry into the `logs` table in the database using a GraphQL mutation.
 * - Supports logging levels (e.g., "info", "warn", "error") with accompanying messages and optional details.
 * - Catches and logs errors if the database logging fails.
 *
 * Parameters:
 * - `level` (String): The severity level of the log (e.g., "info", "warn", "error").
 * - `message` (String): A brief description of the event or issue being logged.
 * - `details` (Object): Additional details or context for the log, stored as JSON.
 *
 * Usage:
 * - Call this function with appropriate parameters to create a structured log entry in the database.
 */

const logToDatabase = async (level, message, details) => {
  const mutation = `
    mutation InsertLog($level: String!, $message: String!, $details: jsonb!) {
      insert_logs(objects: { level: $level, message: $message, details: $details }) {
        affected_rows
      }
    }
  `;

  try {
    await hasuraClient.request(mutation, { level, message, details });
  } catch (error) {
    console.error(`Failed to insert log: ${error.message}`);
  }
};

/**
 * Summary: Starts the server to handle API requests.
 *
 * Details:
 * - Listens on port 3000 and binds to all network interfaces (0.0.0.0).
 * - Logs a message when the server is running.
 */
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));



app.listen(3000, "0.0.0.0", () => {
  console.log("Verification server running on http://0.0.0.0:3000");
});
