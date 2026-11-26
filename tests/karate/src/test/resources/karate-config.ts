function fn() {
  karate.log("=== Starting karate-config.js ===");

  // Configure pretty logging
  karate.configure("logPrettyRequest", true);
  karate.configure("logPrettyResponse", true);

  // The test stack injects the admin secret; never hardcode it.
  var adminSecret = java.lang.System.getenv('HASURA_ADMIN_SECRET');
  if (!adminSecret) {
    throw new Error('HASURA_ADMIN_SECRET is required to run Karate tests');
  }

  // Basic configuration
  var endpoints = {
    baseUrl: karate.properties['baseUrl'] || 'http://graphql-engine-test:8080/v1/graphql',
    webhookUrl: karate.properties['webhookUrl'] || 'http://webhook:3001',
    adminSecret: adminSecret,
  };


  // DB helper factory: one database per tenant, so each helper targets its own database.
  function makeDb(database: string) {
    var url = 'jdbc:postgresql://postgres_test:5432/' + database;
    function connect() {
      var DriverManager = Java.type('java.sql.DriverManager');
      return DriverManager.getConnection(url, 'postgres', 'postgrespassword');
    }
    return {
      query: function(sql: string | JavaString | JavaBytes) {
        if (typeof sql !== 'string') sql = new java.lang.String(sql).toString();
        var conn = connect();
        var stmt = conn.createStatement();
        var rs = stmt.executeQuery(sql);
        var meta = rs.getMetaData();
        var cols = meta.getColumnCount();
        var list = [];
        while (rs.next()) {
          var map: Record<string, string | null> = {};
          for (var i = 1; i <= cols; i++) {
            var name = meta.getColumnName(i);
            map[name] = rs.getString(i);
          }
          list.push(map);
        }
        rs.close();
        stmt.close();
        conn.close();
        return list;
      },
      execute: function(sql: string | JavaString | JavaBytes) {
        if (typeof sql !== 'string') sql = new java.lang.String(sql).toString();
        var conn = connect();
        var stmt = conn.createStatement();
        stmt.execute(sql);
        stmt.close();
        conn.close();
      }
    };
  }
  var db = makeDb('safetrust');
  var hotelDb = makeDb('hotel_industry');

  function bytes(value: string): JavaBytes {
    return new java.lang.String(value).getBytes("UTF-8");
  }

  // Token helper function
  // Minimal HS256 JWT signer for REST endpoints in this repo.
  // Usage: config.restToken({ sub: 'user-id' })
  var restToken = function(payload: Record<string, unknown>) {
    var Base64 = Java.type("java.util.Base64");
    var Mac = Java.type("javax.crypto.Mac");
    var SecretKeySpec = Java.type("javax.crypto.spec.SecretKeySpec");

    var header = { alg: "HS256", typ: "JWT" };
    var secret = java.lang.System.getenv("JWT_SECRET") || "testsecret";

    var enc = Base64.getUrlEncoder().withoutPadding();
    var headerB64 = enc.encodeToString(bytes(JSON.stringify(header)));
    var payloadB64 = enc.encodeToString(bytes(JSON.stringify(payload || {})));
    var signingInput = headerB64 + "." + payloadB64;

    var mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(bytes(secret), "HmacSHA256"));
    var sig = enc.encodeToString(mac.doFinal(bytes(signingInput)));

    return "Bearer " + signingInput + "." + sig;
  };

  var config = { ...endpoints, db, hotelDb, restToken };

  karate.configure('headers', function() {
    return {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': config.adminSecret
    };
  });

  karate.log("Config initialized:", config);
  return config;
}
