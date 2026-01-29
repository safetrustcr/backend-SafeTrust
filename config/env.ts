import { z } from "zod";

const envSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID is required"),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_PRIVATE_KEY_BASE64: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email("FIREBASE_CLIENT_EMAIL must be a valid email"),
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  HASURA_GRAPHQL_JWT_SECRET: z.string().min(1, "HASURA_GRAPHQL_JWT_SECRET is required"),
  HASURA_GRAPHQL_ADMIN_SECRET: z.string().min(1, "HASURA_GRAPHQL_ADMIN_SECRET is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(" Invalid environment configuration:");
  parsed.error.issues.forEach((i) => {
    console.error(` - ${i.path.join(".")}: ${i.message}`);
  });
  process.exit(1);
}

const raw = parsed.data;

/** Normalize private key:
 * Support either FIREBASE_PRIVATE_KEY with escaped newlines, or FIREBASE_PRIVATE_KEY_BASE64.
 */
let firebasePrivateKey: string | undefined = raw.FIREBASE_PRIVATE_KEY;
if (!firebasePrivateKey && raw.FIREBASE_PRIVATE_KEY_BASE64) {
  try {
    firebasePrivateKey = Buffer.from(raw.FIREBASE_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  } catch (err) {
    console.error("Failed to decode FIREBASE_PRIVATE_KEY_BASE64:", err);
    process.exit(1);
  }
}

if (!firebasePrivateKey) {
  console.error("Missing Firebase private key: set FIREBASE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY_BASE64");
  process.exit(1);
}
// Replace literal \n with real newlines if necessary
firebasePrivateKey = firebasePrivateKey.replace(/\\n/g, "\n");

/** Validate HASURA_GRAPHQL_JWT_SECRET is valid JSON and matches expected Firebase values */
let hasuraJwtSecret: any;
try {
  hasuraJwtSecret = JSON.parse(raw.HASURA_GRAPHQL_JWT_SECRET);
  // Basic checks:
  if (hasuraJwtSecret.type !== "RS256") {
    throw new Error("HASURA_GRAPHQL_JWT_SECRET.type must be 'RS256'");
  }
  if (typeof hasuraJwtSecret.jwk_url !== "string" || !hasuraJwtSecret.jwk_url.includes("googleapis.com")) {
    throw new Error("HASURA_GRAPHQL_JWT_SECRET.jwk_url must be Google's securetoken jwk url");
  }
  // Check audience/issuer match the project id
  const proj = raw.FIREBASE_PROJECT_ID;
  if (String(hasuraJwtSecret.audience) !== proj) {
    throw new Error("HASURA_GRAPHQL_JWT_SECRET.audience must equal FIREBASE_PROJECT_ID");
  }
  const expectedIssuer = `https://securetoken.google.com/${proj}`;
  if (String(hasuraJwtSecret.issuer) !== expectedIssuer) {
    throw new Error(`HASURA_GRAPHQL_JWT_SECRET.issuer must equal ${expectedIssuer}`);
  }
} catch (err: any) {
  console.error("Invalid HASURA_GRAPHQL_JWT_SECRET:", err.message || err);
  process.exit(1);
}

export const config = {
  firebase: {
    projectId: raw.FIREBASE_PROJECT_ID,
    clientEmail: raw.FIREBASE_CLIENT_EMAIL,
    privateKey: firebasePrivateKey,
  },
  nextPublic: {
    apiKey: raw.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: raw.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: raw.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: raw.NEXT_PUBLIC_FIREBASE_APP_ID,
  },
  hasura: {
    jwtSecret: hasuraJwtSecret,
    adminSecret: raw.HASURA_GRAPHQL_ADMIN_SECRET,
  },
  databaseUrl: raw.DATABASE_URL,
};
