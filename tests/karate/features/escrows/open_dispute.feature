Feature: Open Dispute Action

Background:
    * url baseUrl
    * header x-hasura-admin-secret = 'myadminsecretkey'
    * def uuid = function() { return java.util.UUID.randomUUID() + '' }
    * def login = read('classpath:auth/login.feature')
    
    # Mock data for testing
    * def testContractId = "test-contract-" + uuid()
    * def testAccount = "GC" + uuid().substring(0, 8).toUpperCase()

Scenario: Successfully open a dispute for property damage
    # 1. Setup: Create needed records (Escrow, Apartment, etc.)
    # In a real environment, we would use seeds or setup steps
    # For this test, we assume existence or use direct SQL if possible
    
    Given request
    """
    {
      query: "mutation OpenDispute($contractId: String!, $senderAddress: String!) {
        open_dispute(input: {contractId: $contractId, senderAddress: $senderAddress}) {
          contractId
          unsignedXdr
        }
      }",
      variables: {
        contractId: "CTR123",
        senderAddress: "GDHB6..."
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.open_dispute.contractId == "CTR123"
    And match response.data.open_dispute.unsignedXdr == "#string"

Scenario: Fail to open dispute if not the owner
    # This would require a JWT from a non-owner user
    # For now, we validate the general structure
    Given header Authorization = "Bearer invalid_token"
    And request
    """
    {
      query: "mutation OpenDispute($contractId: String!, $senderAddress: String!) {
        open_dispute(input: {contractId: $contractId, senderAddress: $senderAddress}) {
          contractId
        }
      }",
      variables: {
        contractId: "CTR123",
        senderAddress: "GDHB6..."
      }
    }
    """
    When method POST
    Then status 200
    # Hasura will return an error due to invalid token or 403 from webhook
    And match response.errors != '#notpresent'
