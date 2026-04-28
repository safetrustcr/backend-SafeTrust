Feature: User Synchronization

Background:
    * url webhookUrl
    * def mockToken = 'mock-token'

Scenario: Sync a new user (first login)
    Given path '/api/auth/sync-user'
    And header Authorization = 'Bearer ' + mockToken
    And header x-test-uid = 'new-user-123'
    And header x-test-email = 'new-user@example.com'
    When method POST
    Then status 200
    And match response.user.email == 'new-user@example.com'
    And match response.user.last_seen != null
    * def firstLastSeen = response.user.last_seen
    And match response.user.last_seen == '#string'
    * def firstLastSeen = response.user.last_seen
    
    # Wait to ensure timestamp updates (Postgres NOW() resolution)
    * eval java.lang.Thread.sleep(1000)

    # Second login should update last_seen
    Given path '/api/auth/sync-user'
    And header Authorization = 'Bearer ' + mockToken
    And header x-test-uid = 'new-user-123'
    And header x-test-email = 'new-user@example.com'
    When method POST
    Then status 200
    And match response.user.last_seen == '#string'
    And match response.user.last_seen != firstLastSeen

Scenario: Sync user with invalid token
    Given path '/api/auth/sync-user'
    And header Authorization = 'Bearer invalid-token'
    When method POST
    Then status 401
    And match response == { error: 'Unauthorized: Invalid token' }

Scenario: Sync user with no token
    Given path '/api/auth/sync-user'
    When method POST
    Then status 401
    And match response == { error: 'Unauthorized: No token provided' }
