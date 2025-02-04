Feature: Test Escrow API Calls

Background:
    * url baseUrl
    * print '=== Loading feature file ==='
    * print 'URL set to:', baseUrl
    * header x-hasura-admin-secret = adminSecret

Scenario: Check GraphQL endpoint health
    Given path '/'
    And request { query: "query { __typename }" }
    When method POST
    Then status 200
    And match response == { data: { __typename: 'query_root' } }

Scenario: Verify escrow_api_calls schema exists
    Given path '/'
    And request
    """
    {
      "query": "query { __type(name: \"escrow_api_calls\") { name fields { name type { name kind } } } }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print 'Schema:', response.data.__type

Scenario: Fetch escrow_api_calls and validate response
    Given path '/'
    And request
    """
    {
      "query": "query GetEscrowApiCalls { escrow_api_calls { http_status_code error_details request_body response_body endpoint method created_at escrow_transaction_id id } }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.escrow_api_calls != null

Scenario: Query escrow API call by ID
    Given path '/'
    And request
    """
    {
      "query": "query GetEscrowApiCall($id: uuid!) {
        escrow_api_calls_by_pk(id: $id) {
          id
          created_at
        }
      }",
      "variables": {
        "id": "9fd0a919-c2d8-448b-8895-bc4c68738804"
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.escrow_api_calls_by_pk != null

Scenario: Update escrow API call request and response bodies
    Given path '/'
    And request
    """
    {
      "query": "mutation UpdateEscrowApiCall($id: uuid!, $request_body: jsonb!, $response_body: jsonb!) {
        update_escrow_api_calls_by_pk(
          pk_columns: {id: $id},
          _set: {request_body: $request_body, response_body: $response_body}
        ) {
          id
          request_body
          response_body
          updated_at
        }
      }",
      "variables": {
        "id": "9f4274d8-ff32-43c2-bc48-1a9f1b5a8177",
        "request_body": {
          "amount": -5000,
          "buyer_id": "12345",
          "currency": "USD",
          "seller_id": "67890"
        },
        "response_body": {
          "status": "error",
          "message": "Invalid amount"
        }
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.update_escrow_api_calls_by_pk.request_body.amount == -5000
    And match response.data.update_escrow_api_calls_by_pk.response_body.status == 'error'

Scenario: List escrow API calls
    Given path '/'
    And request
    """
    {
      "query": "query ListEscrowApiCalls {
        escrow_api_calls(limit: 10, order_by: {created_at: desc}) {
          id
          transaction_id
          status
          amount
          created_at
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.escrow_api_calls != null
    And match response.data.escrow_api_calls == '#[_ > 0]'

Scenario: Delete escrow API call
    Given path '/'
    And request
    """
    {
      "query": "mutation DeleteEscrowApiCall($id: uuid!) {
        delete_escrow_api_calls_by_pk(id: $id) {
          id
        }
      }",
      "variables": {
        "id": "9fd0a919-c2d8-448b-8895-bc4c68738804"
      }
    }
    """
    When method POST
    Then status 204
    And match response.errors == '#notpresent'
    And match response.data.delete_escrow_api_calls_by_pk != null
