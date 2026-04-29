Feature: POST /api/auth/sync-user

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    * def userUid = 'test-sync-user-123'
    * def userEmail = 'sync-user@example.com'
    * db.execute("DELETE FROM users WHERE id = '" + userUid + "'")

  Scenario: First login creates user record
    Given path '/api/auth/sync-user'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = userUid
    And header x-test-email = userEmail
    When method POST
    Then status 200
    And match response.user.email == userEmail
    And match response.user.last_seen != null
    * def firstLastSeen = response.user.last_seen
    And match response.user.last_seen == '#string'
    
    * def count = db.query("SELECT COUNT(*) FROM users WHERE id = '" + userUid + "'")
    And match count[0].count == '1'

  Scenario: Subsequent login updates last_seen only
    # First sync
    Given path '/api/auth/sync-user'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = userUid
    And header x-test-email = userEmail
    When method POST
    Then status 200
    * def firstSeen = response.user.last_seen
    
    * eval java.lang.Thread.sleep(1000)

    # Second sync
    Given path '/api/auth/sync-user'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = userUid
    And header x-test-email = userEmail
    When method POST
    Then status 200
    And match response.user.last_seen != firstSeen
    
    * def count = db.query("SELECT COUNT(*) FROM users WHERE id = '" + userUid + "'")
    And match count[0].count == '1'

  Scenario: Missing token returns 401
    Given path '/api/auth/sync-user'
    When method POST
    Then status 401
    And match response.error == 'Unauthorized: No token provided'
