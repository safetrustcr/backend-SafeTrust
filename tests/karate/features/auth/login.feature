Feature: User Authentication

Background:
    * print '=== Loading feature file ==='
    * url baseUrl
    * print 'URL set to:', baseUrl
    * header x-hasura-admin-secret = adminSecret

Scenario: Check test database connection
    * print 'Starting database check'
    Given path '/'
    And def query = 
    """
    {
      "query": "query { __type(name: \"User\") { fields { name type { name kind } } } }"
    }
    """
    And request query
    When method POST
    Then status 200
    * print 'Schema:', response.data

Scenario: Check test environment health
    * print 'Starting health check'
    Given url baseUrl.replace('/v1/graphql', '/healthz')
    When method GET
    Then status 200
    * print 'Health response:', response