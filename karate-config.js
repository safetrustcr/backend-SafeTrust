function fn() {

  var config = {};

  // environment detection
  var env = karate.env;
  if (!env) env = 'local';

  if (env === 'local') {
    config.baseUrl = 'http://localhost:8080/v1/graphql';
    config.adminSecret = 'myadminsecretkey';
  }

  if (env === 'docker') {
    config.baseUrl = 'http://graphql-engine:8080/v1/graphql';
    config.adminSecret = 'myadminsecretkey';
  }

  karate.log('Base URL:', config.baseUrl);

  return config;
}
