Feature: Query Users

Background:
    * url baseUrl
    * print '=== Loading feature file ==='
    * print 'URL set to:', baseUrl
    * header x-hasura-admin-secret = adminSecret

Scenario: Query existing user
    Given request { query: "{ __typename }" }
    When method POST
    Then status 200
    And match response == { data: { __typename: 'query_root' } }

Scenario: Query non-existing user
    Given request { query: "{ __typename }" }
    When method POST
    Then status 200
    And match response == { data: { __typename: 'query_root' } }