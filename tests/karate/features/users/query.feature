Feature: User Queries

Background:
  * url baseUrl
  * header x-hasura-admin-secret = adminSecret

Scenario: Query User Profile
  Given path '/v1/graphql'
  And request { 
    query: """
      query GetUserProfile($userId: String!) {
        users_by_pk(id: $userId) {
          id
          email
          first_name
          last_name
          country_code
          phone_number
          last_seen
        }
      }
    """,
    variables: { userId: 'test-user-id' }
  }
  When method POST
  Then status 200
  And match response.data.users_by_pk != null
  And match response.errors == '#notpresent'

Scenario: Query User Wallets
  Given path '/v1/graphql'
  And request {
    query: """
      query GetUserWallets($userId: String!) {
        user_wallets(where: {user_id: {_eq: $userId}}) {
          id
          wallet_address
          chain_type
          is_primary
        }
      }
    """,
    variables: { userId: 'test-user-id' }
  }
  When method POST
  Then status 200
  And match response.data.user_wallets == '#array'
  And match response.errors == '#notpresent' 