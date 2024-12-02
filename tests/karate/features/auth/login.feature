Feature: Authentication Tests

Background:
  * url baseUrl
  * def tokenHelper = read('classpath:helpers/generate-token.js')

Scenario: Valid Firebase Token Authentication
  * def validToken = tokenHelper({ uid: 'test-user', role: 'user' })
  Given path '/v1/graphql'
  And header Authorization = 'Bearer ' + validToken
  And request { 
    query: """
      query { users { id } }
    """
  }
  When method POST
  Then status 200
  And match response.errors == '#notpresent'

Scenario: Expired Token Authentication
  * def expiredToken = tokenHelper({ uid: 'test-user', exp: '#(~~(Date.now()/1000 - 3600))' })
  Given path '/v1/graphql'
  And header Authorization = 'Bearer ' + expiredToken
  And request { 
    query: """
      query { users { id } }
    """
  }
  When method POST
  Then status 401

Scenario: Invalid Token Format
  Given path '/v1/graphql'
  And header Authorization = 'Bearer invalid.token.format'
  And request { 
    query: """
      query { users { id } }
    """
  }
  When method POST
  Then status 401 