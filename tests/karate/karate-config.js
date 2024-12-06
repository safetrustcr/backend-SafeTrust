function fn() {
  karate.configure("logPrettyRequest", true);
  karate.configure("logPrettyResponse", true);

  const config = {
    baseUrl: "http://graphql-engine-test:8080/v1/graphql",
    adminSecret: "myadminsecretkey",
  };

  const jwtConfig = {
    type: "HS256",
    key: "12345678901234567890123456789012",
    audience: "safetrust-dev",
    issuer: "https://securetoken.google.com/safetrust-dev",
    claims_namespace: "https://hasura.io/jwt/claims",
  };

  // Use the correct absolute path from the root of the container
  config.authHeader = "Bearer " + karate.callSingle("classpath:helpers/generate-token.js", jwtConfig);

  return config;
}
