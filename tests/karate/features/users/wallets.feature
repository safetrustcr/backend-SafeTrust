Feature: User Wallets

Background:
  * url baseUrl
  * def userId = 'test-user-id'
  * def adminSecret = karate.get('adminSecret')
  * header x-hasura-admin-secret = adminSecret

Scenario: Create Primary Wallet
  Given path '/v1/graphql'
  And request {
    query: """
      mutation CreateWallet($wallet: user_wallets_insert_input!) {
        insert_user_wallets_one(object: $wallet) {
          id
          wallet_address
          is_primary
          chain_type
        }
      }
    """,
    variables: {
      wallet: {
        user_id: '#(userId)',
        wallet_address: '0x' + Date.now(),
        chain_type: 'ETH',
        is_primary: true
      }
    }
  }
  When method POST
  Then status 200
  And match response.data.insert_user_wallets_one.is_primary == true

Scenario: Validate Wallet Address Format
  Given path '/v1/graphql'
  And request {
    query: """
      mutation CreateWallet($wallet: user_wallets_insert_input!) {
        insert_user_wallets_one(object: $wallet) {
          id
          wallet_address
        }
      }
    """,
    variables: {
      wallet: {
        user_id: '#(userId)',
        wallet_address: 'invalid-address',
        chain_type: 'ETH'
      }
    }
  }
  When method POST
  Then status 200
  And match response.errors[0].message contains 'check_valid_wallet_address' 