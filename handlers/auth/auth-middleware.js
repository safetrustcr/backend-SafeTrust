const { getAuth } = require("./firebase-config");

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization_header_missing",
        code: "AUTH_HEADER_MISSING",
      });
    }

    const token = authHeader.startsWith("Bearer")
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
      role: decodedToken.role || "user",
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
  }
};

module.exports = {
  authenticateToken,
};
