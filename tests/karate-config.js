function fn() {
  karate.configure("logPrettyRequest", true);
  karate.configure("logPrettyResponse", true);

  const config = {
    baseUrl: "http://graphql-engine:8080/v1/graphql",
    adminSecret: "myadminsecretkey",
  };

  // Reference the JWT secret from docker-compose.yml
  const jwtConfig = {
    type: "RS256",
    audience: "safetrust-dev",
    issuer: "https://securetoken.google.com/safetrust-dev",
  };

  config.authHeader = "Bearer " + karate.callSingle("classpath:helpers/generate-token.js", jwtConfig);

  return config;
}
