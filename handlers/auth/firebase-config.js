import admin from "firebase-admin";
import dotenv from "dotenv";

// Load environment variables early
dotenv.config();

// Track initialization state
let initialized = false;

/**
 * Validate required Firebase env variables.
 * Throws an error if any required variable is missing.
 */
const validateEnv = () => {
  const required = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ];
  const missing = required.filter(
    (k) => !process.env[k] || process.env[k].trim() === ""
  );
  if (missing.length) {
    console.error(
      `Missing Firebase environment variables: ${missing.join(", ")}`
    );
    throw new Error("FIREBASE_ENV_INCOMPLETE");
  }
};

/**
 * Build credential object from env replacing escaped newlines.
 */
const buildCredentials = () => ({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
});

/**
 * Initialize Firebase Admin SDK (idempotent).
 */
export const initFirebase = () => {
  if (initialized || admin.apps.length) {
    return admin.app();
  }

  validateEnv();

  try {
    admin.initializeApp({
      credential: admin.credential.cert(buildCredentials()),
    });
    initialized = true;
    console.log("[Firebase] Admin SDK initialized");
    return admin.app();
  } catch (error) {
    console.error("[Firebase] Initialization failed:", error.message);
    throw new Error("FIREBASE_INIT_FAILED");
  }
};

/**
 * Get Auth instance (auto initializes if needed).
 */
export const getAuth = () => {
  if (!initialized && !admin.apps.length) {
    initFirebase();
  }
  return admin.auth();
};

/**
 * Lightweight connection test (lists 1 user).
 */
export const testFirebaseConnection = async () => {
  try {
    const auth = getAuth();
    await auth.listUsers(1); // minimal call to confirm credentials
    return {
      success: true,
      status: "CONNECTED",
      projectId: process.env.FIREBASE_PROJECT_ID,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[Firebase] Connection test failed:", error.message);
    return {
      success: false,
      status: "FAILED",
      code: error.code || "FIREBASE_CONNECTION_ERROR",
      message: error.message,
      timestamp: new Date().toISOString(),
    };
  }
};

// Optionally eager initialize in production to fail fast
if (process.env.NODE_ENV === "production") {
  try {
    initFirebase();
  } catch (e) {
    // Allow process manager to decide restart policy
  }
}

export default {
  initFirebase,
  getAuth,
  testFirebaseConnection,
};
