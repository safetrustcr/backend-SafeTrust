Feature: User Permissions

Background:
    * url baseUrl
    * def tokenHelper = read('../../helpers/generate-token.js')

Scenario: User can only access their own data
    # Set up the test data
    * def validToken = tokenHelper({ uid: 'test-user', role: 'user' })
    
    Given path '/v1/graphql'
    And header Authorization = 'Bearer ' + validToken
    And request { query: "query { users { id email } }" }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.users[*].id contains 'test-user' 