Feature: Test Escrow API Calls

  Background:
    * url baseUrl
    * def escrowId = "uuid-1"

  Scenario: Create escrow API call successfully
    Given url baseUrl + '/api/escrow/create'
    And header x-hasura-admin-secret = adminSecret
    And request { "amount": 5000, "currency": "USD", "buyer_id": "12345", "seller_id": "67890" }
    When method post
    Then status 201
    And match response.status == "success"
    And match response.escrow_id == "#notnull"

  Scenario: Query escrow API call by ID
    Given url baseUrl + '/api/escrow/status'
    And header x-hasura-admin-secret = adminSecret
    And request { "escrow_id": "#(escrowId)" }
    When method get
    Then status 200
    And match response.status == "active"
    And match response.escrow_id == escrowId

  Scenario: Update escrow API call details
    Given url baseUrl + '/api/escrow/update'
    And header x-hasura-admin-secret = adminSecret
    And request { "escrow_id": "#(escrowId)", "status": "completed" }
    When method put
    Then status 200
    And match response.status == "success"
    And match response.updated_at == "#notnull"

  Scenario: Delete escrow API call
    Given url baseUrl + '/api/escrow/cancel'
    And header x-hasura-admin-secret = adminSecret
    And request { "escrow_id": "#(escrowId)" }
    When method delete
    Then status 204

  Scenario: List all escrow API calls
    Given url baseUrl + '/api/escrow/list'
    And header x-hasura-admin-secret = adminSecret
    When method get
    Then status 200
    And match response contains { "escrows": "#array" }
    And match response.escrows[0].escrow_id == "#notnull"

  Scenario: Attempt to create escrow with invalid amount
    Given url baseUrl + '/api/escrow/create'
    And header x-hasura-admin-secret = adminSecret
    And request { "amount": -5000, "currency": "USD", "buyer_id": "12345", "seller_id": "67890" }
    When method post
    Then status 400
    And match response.status == "error"
    And match response.message == "Invalid amount"
    And match response.error_code == "INVALID_AMOUNT"

  Scenario: Attempt to get escrow status with invalid ID
    Given url baseUrl + '/api/escrow/status'
    And header x-hasura-admin-secret = adminSecret
    And request { "escrow_id": "invalid-uuid" }
    When method get
    Then status 500
    And match response.status == "error"
    And match response.message == "Internal Server Error"
    And match response.error_code == "SERVER_ERROR"
