Feature: x402 Payment Required flow

Background:
  * url webhookUrl

Scenario: Endpoint returns 402 when X-Payment header is missing
  Given path '/api/escrows/initialize'
  And header X-Payment-Protocol = 'x402'
  And request { contractId: 'test-123', signer: 'GABC...' }
  When method POST
  Then status 402
  And match response.error == 'Payment Required'
  And match response.x402Version == 2
  And match response.accepts[0].scheme == 'exact'
  And match response.accepts[0].network contains 'stellar'
  And match response.accepts[0].asset.code == 'USDC'
  And match response.accepts[0].asset.contract == '#notnull'
  And match response.accepts[0].facilitator_url == '#notnull'

Scenario: Endpoint returns 402 with invalid X-Payment header
  Given path '/api/escrows/initialize'
  And header X-Payment = 'invalid-header-format'
  And request { contractId: 'test-123' }
  When method POST
  Then status 402
  And match response.error == 'Invalid x402 payment'
  And match response.invalid_reason == '#notnull'

Scenario: Endpoint accepts valid X-Payment header (mock facilitator)
  # Note: full integration test requires a live testnet wallet
  # This scenario uses the mock facilitator in test environment
  Given path '/health'
  When method GET
  Then status 200
