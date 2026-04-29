Feature: Auth Middleware

  Background:
    * url webhookUrl

  Scenario: No Authorization header → 401
    Given path '/api/auth/sync-user'
    When method POST
    Then status 401
    And match response.error == 'Unauthorized: No token provided'

  Scenario: Invalid token format (no Bearer prefix) → 401
    Given path '/api/auth/sync-user'
    And header Authorization = 'Basic abc'
    When method POST
    Then status 401
    And match response.error == 'Unauthorized: No token provided'

  Scenario: Invalid/Expired token → 401
    Given path '/api/auth/sync-user'
    And header Authorization = restToken({ uid: 'test-user', role: 'user' })
    When method POST
    Then status 401
    And match response.error == 'Unauthorized: Invalid token'

  Scenario: Valid token → passes through
    Given path '/api/auth/sync-user'
    And header Authorization = 'Bearer ' + karate.call('classpath:helpers/get-firebase-token.js')
    When method POST
    Then status 200
