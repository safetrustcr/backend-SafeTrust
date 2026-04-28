function fn() {
  karate.log("=== Starting karate-config.js ===");

  // Configure pretty logging
  karate.configure("logPrettyRequest", true);
  karate.configure("logPrettyResponse", true);

  // Basic configuration
  var config = {
    baseUrl: "http://graphql-engine-test:8080/v1/graphql",
    webhookUrl: karate.properties['webhookUrl'] || "http://webhook:3001",
    adminSecret: "myadminsecretkey",
  };

  // DB helper
  config.db = {
    query: function(sql) {
      if (typeof sql !== 'string') sql = new java.lang.String(sql).toString();
      var DriverManager = Java.type('java.sql.DriverManager');
      var conn = DriverManager.getConnection(
        'jdbc:postgresql://postgres_test:5432/postgres',
        'postgres',
        'postgrespassword'
      );
      var stmt = conn.createStatement();
      var rs = stmt.executeQuery(sql);
      var meta = rs.getMetaData();
      var cols = meta.getColumnCount();
      var list = [];
      while (rs.next()) {
        var map = {};
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
    execute: function(sql) {
      if (typeof sql !== 'string') sql = new java.lang.String(sql).toString();
      var DriverManager = Java.type('java.sql.DriverManager');
      var conn = DriverManager.getConnection(
        'jdbc:postgresql://postgres_test:5432/postgres',
        'postgres',
        'postgrespassword'
      );
      var stmt = conn.createStatement();
      stmt.execute(sql);
      stmt.close();
      conn.close();
    }
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

  // Set default headers
  karate.configure('headers', {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': config.adminSecret
  });

  karate.log("Config initialized:", config);
  return config;
}
