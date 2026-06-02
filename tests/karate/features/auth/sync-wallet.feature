Feature: POST /api/auth/sync-wallet

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    # owner-123 is seeded by seed-test-users.sql
    * def testUid = 'owner-123'
    * def stellarAddress = 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute("DELETE FROM public.user_wallets WHERE wallet_address = '" + stellarAddress + "'")

  Scenario: Insert new Stellar wallet → 200 with success and wallet_address
    Given path '/api/auth/sync-wallet'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = testUid
    And request { wallet_address: '#(stellarAddress)', chain_type: 'STELLAR', is_primary: true }
    When method POST
    Then status 200
    And match response.success == true
    And match response.wallet_address == stellarAddress
    * def rows = db.query("SELECT * FROM public.user_wallets WHERE wallet_address = '" + stellarAddress + "'")
    And match rows[0].user_id == testUid
    And match rows[0].chain_type == 'STELLAR'
    And match rows[0].is_primary == 'true'

  Scenario: Upsert same address updates user_id and is_primary
    # Pre-seed the address under tenant-456, then reassign it to testUid via the endpoint
    * db.execute("INSERT INTO public.user_wallets (user_id, wallet_address, chain_type, is_primary) VALUES ('tenant-456', '" + stellarAddress + "', 'STELLAR', false)")
    Given path '/api/auth/sync-wallet'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = testUid
    And request { wallet_address: '#(stellarAddress)', chain_type: 'STELLAR', is_primary: false }
    When method POST
    Then status 200
    And match response.success == true
    * def rows = db.query("SELECT * FROM public.user_wallets WHERE wallet_address = '" + stellarAddress + "'")
    And match rows[0].user_id == testUid

  Scenario: Missing wallet_address → 400
    Given path '/api/auth/sync-wallet'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = testUid
    And request { chain_type: 'STELLAR', is_primary: false }
    When method POST
    Then status 400
    And match response.error == 'wallet_address is required'

  Scenario: Invalid chain_type → 400
    Given path '/api/auth/sync-wallet'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = testUid
    And request { wallet_address: '#(stellarAddress)', chain_type: 'INVALID', is_primary: false }
    When method POST
    Then status 400
    And match response.error contains 'chain_type must be one of'

  Scenario: Invalid Stellar address format → 400
    Given path '/api/auth/sync-wallet'
    And header Authorization = 'Bearer ' + validToken
    And header x-test-uid = testUid
    And request { wallet_address: 'not-a-stellar-address', chain_type: 'STELLAR', is_primary: false }
    When method POST
    Then status 400
    And match response.error == 'Invalid Stellar wallet address'

  Scenario: No token → 401
    Given path '/api/auth/sync-wallet'
    And request { wallet_address: '#(stellarAddress)', chain_type: 'STELLAR', is_primary: false }
    When method POST
    Then status 401
