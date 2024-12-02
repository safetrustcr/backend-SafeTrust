Feature: User Permissions

Background:
  * url baseUrl
  * def testUserId = 'test-user-id'

Scenario: Verify User Role Permissions
  Given path '/v1/graphql'
  And header Authorization = authHeader
  And header x-hasura-role = 'users'
  And request {
    query: """
      query GetUserProfile($userId: String!) {
        users_by_pk(id: $userId) {
          id
          email
          first_name
          last_name
        }
      }
    """,
    variables: { userId: testUserId }
  }
  When method POST
  Then status 200
  And match response.data.users_by_pk != null
  And match response.errors == '#notpresent' 