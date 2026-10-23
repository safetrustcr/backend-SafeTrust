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
    // DB helper
    var db = {
        query: function (sql) {
            if (typeof sql !== 'string')
                sql = new java.lang.String(sql).toString();
            var DriverManager = Java.type('java.sql.DriverManager');
            var conn = DriverManager.getConnection('jdbc:postgresql://postgres_test:5432/postgres', 'postgres', 'postgrespassword');
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
        execute: function (sql) {
            if (typeof sql !== 'string')
                sql = new java.lang.String(sql).toString();
            var DriverManager = Java.type('java.sql.DriverManager');
            var conn = DriverManager.getConnection('jdbc:postgresql://postgres_test:5432/postgres', 'postgres', 'postgrespassword');
            var stmt = conn.createStatement();
            stmt.execute(sql);
            stmt.close();
            conn.close();
        }
    };
    function bytes(value) {
        return new java.lang.String(value).getBytes("UTF-8");
    }
    // Token helper function
    // Minimal HS256 JWT signer for REST endpoints in this repo.
    // Usage: config.restToken({ sub: 'user-id' })
    var restToken = function (payload) {
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
    // TrustlessWork webhook signature helper
    // Signs canonical bytes `timestamp + '.' + rawBody`. Generates a timestamp
    // and stores it so the per-request headers function can send the same value.
    // Usage: header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    var twTimestamp = null;
    var trustlessWorkSignature = function (rawBody) {
        var Mac = Java.type("javax.crypto.Mac");
        var SecretKeySpec = Java.type("javax.crypto.spec.SecretKeySpec");
        var secret = java.lang.System.getenv("TRUSTLESSWORK_WEBHOOK_SECRET") || "dev-secret";
        var ts = String(new Date().getTime());
        twTimestamp = ts;
        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(bytes(secret), "HmacSHA256"));
        var digest = mac.doFinal(bytes(ts + "." + rawBody));
        var hex = "";
        for (var i = 0; i < digest.length; i++) {
            var b = digest[i] & 0xff;
            hex += (b < 16 ? "0" : "") + b.toString(16);
        }
        return "sha256=" + hex;
    };
    // Returns the timestamp that was just signed, or a fresh one for unsigned calls.
    var pendingTrustlessWorkTimestamp = function () {
        if (twTimestamp) {
            return twTimestamp;
        }
        return String(new Date().getTime());
    };
    var config = { ...endpoints, db, restToken, trustlessWorkSignature, pendingTrustlessWorkTimestamp };
    // Evaluated for every HTTP request so the timestamp is not frozen at config load.
    karate.configure('headers', function () {
        return {
            'Content-Type': 'application/json',
            'x-hasura-admin-secret': config.adminSecret,
            'x-trustlesswork-timestamp': config.pendingTrustlessWorkTimestamp()
        };
    });
    karate.log("Config initialized:", config);
    return config;
}
