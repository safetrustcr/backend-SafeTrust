Feature: Escrow Transactions Management

  Background:
    * url baseUrl

  Scenario: Create escrow transaction with all required fields
    Given path 'escrow_transactions'
    And request { "amount": 1000, "currency": "USD", "sender_id": 1, "receiver_id": 2 }
    When method post
    Then status 201
    And match response contains { "id": '#notnull', "amount": 1000 }

  Scenario: Query escrow transaction by ID
    Given path 'escrow_transactions', 1
    When method get
    Then status 200
    And match response contains { "id": 1, "amount": 1000 }

  Scenario: Query non-existent escrow transaction by ID
    Given path 'escrow_transactions', 999
    When method get
    Then status 404
    And match response == { "error": "resource does not exist", "path": "$", "code": "not-found" }

  Scenario: Update escrow transaction details
    Given path 'escrow_transactions', 1
    And request { "amount": 1500 }
    When method put
    Then status 200
    And match response contains { "amount": 1500 }

  Scenario: Delete escrow transaction
    Given path 'escrow_transactions', 1
    When method delete
    Then status 204

  Scenario: List escrow transactions
    Given path 'escrow_transactions'
    When method get
    Then status 200
    And match response contains [ { "id": '#notnull', "amount": '#number' } ]