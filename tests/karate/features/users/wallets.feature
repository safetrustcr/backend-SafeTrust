Feature: User Wallets

Background:
    * url baseUrl
    * def tokenHelper = read('../../helpers/generate-token.js')

Scenario: User can view their wallets
    # Set up the test data
    * def validToken = tokenHelper({ uid: 'test-user', role: 'user' })
    
    Given path '/v1/graphql'
    And header Authorization = 'Bearer ' + validToken
    And request { query: "query { wallets { id address balance } }" }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.wallets[*].id contains any ['#string'] 