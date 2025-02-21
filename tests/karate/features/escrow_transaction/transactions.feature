Feature: Escrow Transactions Management

Background:
    * url baseUrl
    * header x-hasura-admin-secret = 'myadminsecretkey'
    * def uuid = function() { return java.util.UUID.randomUUID() + '' }
    * def testEscrowTransaction =
      """
      {
        transaction_type: "CREATE_ESCROW",
        status: "PENDING",
        amount: 1000.00,
        initial_deposit_percentage: 50
      }
      """

@create
Scenario: Create and Delete Escrow Transaction
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "mutation CreateEscrowTransaction($object: escrow_transactions_insert_input!) {
        insert_escrow_transactions_one(object: $object) {
          id
          transaction_type
          status
          amount
          initial_deposit_percentage
        }
      }",
      variables: {
        object: #(testEscrowTransaction)
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def createdEscrowId = response.data.insert_escrow_transactions_one.id

    # Cleanup - Add header again as Karate resets between steps
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "mutation DeleteEscrowTransaction($id: uuid!) {
        delete_escrow_transactions(where: {id: {_eq: $id}}) {
          affected_rows
        }
      }",
      variables: {
        id: '#(createdEscrowId)'
      }
    }
    """
    When method POST
    Then status 200
    And match response.data.delete_escrow_transactions.affected_rows == 1

@query
Scenario: Query Escrow Transaction by ID
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "mutation CreateEscrowTransaction($object: escrow_transactions_insert_input!) {
        insert_escrow_transactions_one(object: $object) {
          id
        }
      }",
      variables: {
        object: #(testEscrowTransaction)
      }
    }
    """
    When method POST
    Then status 200
    * def escrowId = response.data.insert_escrow_transactions_one.id

    # Query with header
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "query GetEscrowTransaction($id: uuid!) {
        escrow_transactions_by_pk(id: $id) {
          id
          transaction_type
          status
          amount
          initial_deposit_percentage
        }
      }",
      variables: {
        id: '#(escrowId)'
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'

    # Cleanup
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "mutation DeleteEscrowTransaction($id: uuid!) {
        delete_escrow_transactions(where: {id: {_eq: $id}}) {
          affected_rows
        }
      }",
      variables: {
        id: '#(escrowId)'
      }
    }
    """
    When method POST
    Then status 200

@validation
Scenario: Create with Negative Amount (Invalid)
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    * def invalidEscrow = { transaction_type: "CREATE_ESCROW", status: "PENDING", amount: -100.00 }
    And request
    """
    {
      query: "mutation CreateEscrowTransaction($object: escrow_transactions_insert_input!) {
        insert_escrow_transactions_one(object: $object) {
          id
        }
      }",
      variables: {
        object: #(invalidEscrow)
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors != '#notpresent'
