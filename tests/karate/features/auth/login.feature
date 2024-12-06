Feature: User Authentication

Background:
    * url baseUrl
    * def tokenHelper = read('../../helpers/generate-token.js')

Scenario: User can login with valid credentials
    # Set up the test data
    * def validToken = tokenHelper({ uid: 'test-user', role: 'user' })
    
    Given path '/v1/graphql'
    And header Authorization = 'Bearer ' + validToken
    And request { query: "query { me { id email } }" }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.me.id == 'test-user'

Scenario: User cannot access without token
    Given path '/v1/graphql'
    And request { query: "query { me { id email } }" }
    When method POST
    Then status 401 