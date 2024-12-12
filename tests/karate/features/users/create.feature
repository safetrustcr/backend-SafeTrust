Feature: Create User

Background:
    * url baseUrl
    * print '=== Loading feature file ==='
    * print 'URL set to:', baseUrl

Scenario: Check Hasura health
    Given path ''
    And header x-hasura-admin-secret = adminSecret
    And request { query: "query { __typename }" }
    When method POST
    Then status 200
    And match response == { data: { __typename: 'query_root' } }
