import { GraphQLClient } from "graphql-request";
import express from "express";
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

// Function: Logs events to the database
const logToDatabase = async (level, message, details = {}) => {
  const mutation = `
    mutation InsertLog($level: String!, $message: String!, $details: jsonb!) {
      insert_logs_one(object: {
        level: $level,
        message: $message,
        details: $details
      }) {
        id
      }
    }
  `;
  try {
    await hasuraClient.request(mutation, { level, message, details });
  } catch (error) {
    console.error("Failed to log to database:", error);
  }
};

/**
 * Summary: Handles the endpoint to send a verification code to the user's email.
 */
app.post("/send-verification", limiter, async (req, res) => {
  const email = req.body.input?.input?.email;

  await logToDatabase("info", "Request received at /send-verification", { email });

  if (!email) {
    await logToDatabase("warn", "Missing email in /send-verification request", {});
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
    await hasuraClient.request(mutation, { email, code, expiresAt });

    const mailOptions = {
      from: "Safetrust",
      to: email,
      subject: "Verification Code",
      text: `Your verification code is: ${code}`,
    };

    await transporter.sendMail(mailOptions);

    await logToDatabase("info", `Verification code sent to ${email}`, { code, expiresAt });

    return res.json({
      success: true,
      message: "Verification code sent",
      expiresAt,
    });
  } catch (error) {
    await logToDatabase("error", "Failed to send verification code", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Failed to send verification code",
    });
  }
});

/**
 * Summary: Handles the endpoint to verify the user's email using a code.
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
 * Summary: Starts the server to handle API requests.
 */
app.listen(3000, "0.0.0.0", () => {
  console.log("Verification server running on http://0.0.0.0:3000");
});
