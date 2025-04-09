Feature: Test Escrows

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

  Scenario: Fetch 677AZ and validate response
    Given path '/'
    And request
    """
    {
      "query": "query GetEscrowsApiCalls {
        public_escrow_api_calls {
          http_status_code
          error_details
          request_body
          response_body
          endpoint
          method
          created_at
          escrow_transaction_id
          id
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.escrow_api_calls != null
