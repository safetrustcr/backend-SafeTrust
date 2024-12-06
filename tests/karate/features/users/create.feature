Feature: User Creation

Background:
    * url baseUrl
    * def tokenHelper = read('../../helpers/generate-token.js')

Scenario: Admin can create a new user
    # Set up the test data
    * def adminToken = tokenHelper({ uid: 'admin-user', role: 'admin' })
    * def newUser = { email: 'new@example.com', password: 'password123' }
    
    Given path '/v1/graphql'
    And header Authorization = 'Bearer ' + adminToken
    And request { query: "mutation($user: UserInput!) { createUser(user: $user) { id email } }", variables: { user: '#(newUser)' } }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.createUser.email == newUser.email 