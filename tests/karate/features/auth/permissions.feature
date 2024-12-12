Feature: Authorization Permissions

Background:
    * url baseUrl
    * print '=== Loading feature file ==='
    * print 'URL set to:', baseUrl

Scenario: User can access their own data
    * def token = tokenHelper({ uid: 'test-user', role: 'user' })
    * header Authorization = token
    * header x-hasura-admin-secret = adminSecret

    Given path '/'
    And request { query: "{ __type(name: \"User\") { fields { name } } }" }
    When method POST
    Then status 200
