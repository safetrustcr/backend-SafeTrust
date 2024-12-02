Feature: User Creation

Background:
  * url baseUrl
  * def adminSecret = karate.get('adminSecret')
  * header x-hasura-admin-secret = adminSecret

Scenario: Create New User
  Given path '/v1/graphql'
  And request {
    query: """
      mutation CreateUser($user: users_insert_input!) {
        insert_users_one(object: $user) {
          id
          email
          first_name
          last_name
        }
      }
    """,
    variables: {
      user: {
        id: 'test-user-' + Date.now(),
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User'
      }
    }
  }
  When method POST
  Then status 200
  And match response.data.insert_users_one != null
  And match response.errors == '#notpresent'

Scenario: Prevent Duplicate Email
  Given path '/v1/graphql'
  And request {
    query: """
      mutation CreateUser($user: users_insert_input!) {
        insert_users_one(object: $user) {
          id
          email
        }
      }
    """,
    variables: {
      user: {
        id: 'test-user-' + Date.now(),
        email: 'existing@example.com'
      }
    }
  }
  When method POST
  Then status 200
  And match response.errors[0].message contains 'unique constraint' 