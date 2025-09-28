import { getAuth } from "./firebase-config.js";


export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization_header_missing",
        code: "AUTH_HEADER_MISSING",
      });
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Token missing from authorization header",
        code: "TOKEN_MISSING",
      });
    }

    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name,
      picture: decodedToken.picture,
      role: decodedToken.role,
    };

    next();
  } catch (error) {
    console.error("Hey Dude!! Token verification error:", error);

    let message = "Invalid or expired token";
    let code = "TOKEN_INVALID";

    if (error.code === "auth/id-token-expired") {
      message = "Token has expired";
      code = "TOKEN_EXPIRED";
    } else if (error.code === "auth/id-token-revoked") {
      message = "Token has been revoked";
      code = "TOKEN_REVOKED";
    }

    return res.status(401).json({
      success: false,
      message,
      code,
    });

const VALID_ROLES = ["tenant", "landlord", "admin"];
const DEFAULT_ROLE = "tenant";

//  checkING if user has role
export const requireRole = (requiredRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "AUTH_REQUIRED",
        code: "AUTH_REQUIRED",
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(requiredRoles)
      ? requiredRoles
      : [requiredRoles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "ROLE_NOT_ALLOWED",
        code: "INSUFFICIENT_PERMISSIONS",
        userRole,
        requiredRoles: allowedRoles,
      });
    }

    next();
  };
};

// Build Hasura claims object
export const buildHasuraClaims = (uid, role = DEFAULT_ROLE) => {
  if (!VALID_ROLES.includes(role)) {
    console.warn(`INVALID_ROLE_${role}_DEFAULTING_${DEFAULT_ROLE}`);
    role = DEFAULT_ROLE;
  }

  return {
    "https://hasura.io/jwt/claims": {
      "x-hasura-default-role": role,
      "x-hasura-allowed-roles": VALID_ROLES,
      "x-hasura-user-id": uid,
      "x-hasura-user-type": role,
    },
  };
};

// Set custom claims
export const setCustomClaims = async (uid, role = DEFAULT_ROLE) => {
  if (!uid) throw new Error("UID_IS_REQUIRED");

  const auth = getAuth();
  const claims = buildHasuraClaims(uid, role);

  try {
    await auth.setCustomUserClaims(uid, claims);
    console.log(`SET_CLAIMS_${uid}_ROLE_${role}`);
    return claims;
  } catch (error) {
    console.error("SET_CLAIMS_ERROR", error);
    throw new Error("SET_CLAIMS_FAILED");
  }
};

// Update user role
export const updateUserRole = async (uid, newRole) => {
  if (!VALID_ROLES.includes(newRole)) {
    throw new Error("INVALID_ROLE");
  }

  try {
    const claims = await setCustomClaims(uid, newRole);
    console.log(`UPDATE_ROLE_${uid}_TO_${newRole}`);
    return claims;
  } catch (error) {
    console.error(`UPDATE_ROLE_ERROR_${uid}`, error);
    throw new Error("UPDATE_ROLE_FAILED");
  }
};

// Ensure Hasura claims exist
export const ensureHasuraClaims = async (uid, tokenPayload = {}) => {
  const auth = getAuth();

  try {
    const userRecord = await auth.getUser(uid);
    const existing = userRecord.customClaims || {};
    const existingHasura = existing["https://hasura.io/jwt/claims"];

    if (
      existingHasura &&
      existingHasura["x-hasura-user-id"] === uid &&
      VALID_ROLES.includes(existingHasura["x-hasura-default-role"])
    ) {
      return existing;
    }

    const roleHint =
      tokenPayload.role ||
      tokenPayload.roleName ||
      tokenPayload.user_type ||
      DEFAULT_ROLE;

    const claims = buildHasuraClaims(uid, roleHint);
    await auth.setCustomUserClaims(uid, claims);
    console.log(`ENSURE_CLAIMS_${uid}_ROLE_${roleHint}`);

    return claims;
  } catch (error) {
    console.error("ENSURE_CLAIMS_ERROR", error);
    if (error.code === "auth/user-not-found") {
      throw new Error("USER_NOT_FOUND");
    }
    throw new Error("ENSURE_CLAIMS_FAILED");
  }
};

// Get user role + claims
export const getUserRole = async (uid) => {
  try {
    const auth = getAuth();
    const userRecord = await auth.getUser(uid);
    const claims = userRecord.customClaims || {};
    const hasuraClaims = claims["https://hasura.io/jwt/claims"] || {};

    return {
      uid,
      role: hasuraClaims["x-hasura-default-role"] || null,
      allowedRoles: hasuraClaims["x-hasura-allowed-roles"] || [],
      userType: hasuraClaims["x-hasura-user-type"] || null,
      hasValidClaims: !!hasuraClaims["x-hasura-user-id"],
      claims: hasuraClaims,
    };
  } catch (error) {
    console.error(`GET_ROLE_ERROR_${uid}`, error);
    throw new Error("GET_ROLE_FAILED");
  }
};

// Verify Firebase token for Hasura
export const verifyFirebaseToken = async (token) => {
  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(token);

    const claims = await ensureHasuraClaims(decodedToken.uid, decodedToken);
    const hasuraClaims = claims["https://hasura.io/jwt/claims"];

    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      ...hasuraClaims,
    };
  } catch (error) {
    console.error("VERIFY_TOKEN_ERROR", error);
    throw new Error("TOKEN_INVALID");

  }
};
