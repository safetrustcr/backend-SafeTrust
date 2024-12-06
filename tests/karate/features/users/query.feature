Feature: User Queries

Background:
    * url baseUrl
    * def tokenHelper = read('../../helpers/generate-token.js')

Scenario: User can query their own profile
    # Set up the test data
    * def validToken = tokenHelper({ uid: 'test-user', role: 'user' })
    
    Given path '/v1/graphql'
    And header Authorization = 'Bearer ' + validToken
    And request { query: "query { user(id: \"test-user\") { id email } }" }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.user.id == 'test-user'

Scenario: User cannot query other users' profiles
    * def validToken = tokenHelper({ uid: 'test-user', role: 'user' })
    
    Given path '/v1/graphql'
    And header Authorization = 'Bearer ' + validToken
    And request { query: "query { user(id: \"other-user\") { id email } }" }
    When method POST
    Then status 200
    And match response.data.user == null