function fn() {
  karate.log("=== Starting karate-config.js ===");

  // Configure pretty logging
  karate.configure("logPrettyRequest", true);
  karate.configure("logPrettyResponse", true);

  // Basic configuration
  var config = {
    baseUrl: "http://graphql-engine-test:8080/v1/graphql",
    adminSecret: "myadminsecretkey",
  };

  // Token helper function
  config.tokenHelper = function(claims) {
    var Base64 = Java.type("java.util.Base64");
    var defaultClaims = {
      "https://hasura.io/jwt/claims": {
        "x-hasura-allowed-roles": ["user"],
        "x-hasura-default-role": "user",
        "x-hasura-user-id": claims.uid || "00000000-0000-0000-0000-000000000000",
      },
    };

    if (claims && claims.role === "admin") {
      defaultClaims["https://hasura.io/jwt/claims"] = {
        "x-hasura-allowed-roles": ["user", "admin"],
        "x-hasura-default-role": "admin",
        "x-hasura-user-id": "admin-user",
      };
    }

    var header = { alg: "HS256", typ: "JWT" };

    // Properly encode each part
    var headerBase64 = Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.stringify(header).getBytes("UTF-8"));
    var payloadBase64 = Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.stringify(defaultClaims).getBytes("UTF-8"));

    return "Bearer " + headerBase64 + "." + payloadBase64 + ".your-secret-key";
  };

  // Minimal HS256 JWT signer for REST endpoints in this repo.
  // Usage: config.restToken({ sub: 'user-id' })
  config.restToken = function(payload) {
    var Base64 = Java.type("java.util.Base64");
    var Mac = Java.type("javax.crypto.Mac");
    var SecretKeySpec = Java.type("javax.crypto.spec.SecretKeySpec");

    var header = { alg: "HS256", typ: "JWT" };
    var secret = java.lang.System.getenv("JWT_SECRET") || "testsecret";

    var enc = Base64.getUrlEncoder().withoutPadding();
    var headerB64 = enc.encodeToString(JSON.stringify(header).getBytes("UTF-8"));
    var payloadB64 = enc.encodeToString(JSON.stringify(payload || {}).getBytes("UTF-8"));
    var signingInput = headerB64 + "." + payloadB64;

    var mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes("UTF-8"), "HmacSHA256"));
    var sig = enc.encodeToString(mac.doFinal(signingInput.getBytes("UTF-8")));

    return "Bearer " + signingInput + "." + sig;
  };

  // Set default headers
  karate.configure('headers', {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': config.adminSecret
  });

  karate.log("Config initialized:", config);
  return config;
}
