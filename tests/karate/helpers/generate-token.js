function fn(jwtConfig) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: jwtConfig.issuer || "https://securetoken.google.com/safetrust-dev",
    aud: jwtConfig.audience || "safetrust-dev",
    auth_time: now,
    user_id: jwtConfig.uid || "test-user",
    sub: jwtConfig.uid || "test-user",
    iat: now,
    exp: now + 3600, // Token expires in 1 hour
    "https://hasura.io/jwt/claims": {
      "x-hasura-allowed-roles": ["user", "admin"],
      "x-hasura-default-role": jwtConfig.role || "user",
      "x-hasura-user-id": jwtConfig.uid || "test-user",
    },
  };

  // Use Karate's built-in Java crypto utilities
  var crypto = Java.type("javax.crypto.Mac");
  var b64 = Java.type("java.util.Base64");
  var string = Java.type("java.lang.String");

  function base64UrlEncode(str) {
    var bytes = new string(str).getBytes();
    return b64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  function sign(input, key) {
    var hmac = crypto.getInstance("HmacSHA256");
    var secretKey = new javax.crypto.spec.SecretKeySpec(new string(key).getBytes(), "HmacSHA256");
    hmac.init(secretKey);
    var hash = hmac.doFinal(new string(input).getBytes());
    return b64.getUrlEncoder().withoutPadding().encodeToString(hash);
  }

  var encodedHeader = base64UrlEncode(JSON.stringify(header));
  var encodedPayload = base64UrlEncode(JSON.stringify(payload));
  var signature = sign(encodedHeader + "." + encodedPayload, jwtConfig.key || "12345678901234567890123456789012");

  return encodedHeader + "." + encodedPayload + "." + signature;
}
