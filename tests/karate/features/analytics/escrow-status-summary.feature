Feature: Escrow Status Summary GraphQL Contract and Metric Validations

Background:
    * url baseUrl
    * header x-hasura-admin-secret = adminSecret
    * configure logPrettyRequest = true
    * configure logPrettyResponse = true

    # Clean test fixtures after completion
    * configure afterScenario = function(){ db.execute(karate.read('file:tests/fixtures/analytics/clean-analytics.sql')); }

Scenario: Contract - get_escrow_status_summary field names and types
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-analytics-standard.sql'))
    Given request
    """
    {
        "query": "query GetSummary($tenant: String) { get_escrow_status_summary(args: {tenant_id_input: $tenant}) { total_escrows active_escrows completed_escrows disputed_escrows total_value pending_value } }",
        "variables": {
            "tenant": "safetrust"
        }
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_status_summary == '#[1]'
    # Validate structure and data types
    And match response.data.get_escrow_status_summary[0] contains
    """
    {
        total_escrows: '#number',
        active_escrows: '#number',
        completed_escrows: '#number',
        disputed_escrows: '#number',
        total_value: '#number',
        pending_value: '#number'
    }
    """
    # Assert exact numeric totals aligned with ANA-03
    And match response.data.get_escrow_status_summary[0] ==
    """
    {
        total_escrows: 6,
        active_escrows: 3,
        completed_escrows: 1,
        disputed_escrows: 1,
        total_value: 4150,
        pending_value: 400
    }
    """

Scenario: Default tenant parameter - operates without explicit arguments
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-analytics-standard.sql'))
    Given request
    """
    {
        "query": "query GetSummaryDefault { get_escrow_status_summary { total_escrows active_escrows total_value pending_value } }"
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_status_summary == '#[1]'
    And match response.data.get_escrow_status_summary[0].total_escrows == 6
    And match response.data.get_escrow_status_summary[0].active_escrows == 3
    And match response.data.get_escrow_status_summary[0].total_value == 4150
    And match response.data.get_escrow_status_summary[0].pending_value == 400

Scenario: Diagram 1 - Multi-asset escrow status aggregation
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-multi-asset.sql'))
    Given request
    """
    {
        "query": "query GetMultiAssetSummary { get_escrow_status_summary(args: {tenant_id_input: \"safetrust\"}) { total_escrows active_escrows total_value pending_value } }"
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_status_summary == '#[1]'
    # 3 total escrows, 2 active (funded 500 + active 250), total_value 900, pending_value 150 (created)
    And match response.data.get_escrow_status_summary[0] == { total_escrows: 3, active_escrows: 2, total_value: 900, pending_value: 150 }

Scenario: Empty tenant - returns zeroed counts without nulls
    Given request
    """
    {
        "query": "query GetEmptyTenantSummary { get_escrow_status_summary(args: {tenant_id_input: \"non-existent-tenant\"}) { total_escrows active_escrows completed_escrows disputed_escrows total_value pending_value } }"
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_status_summary == '#[1]'
    And match response.data.get_escrow_status_summary[0] ==
    """
    {
        total_escrows: 0,
        active_escrows: 0,
        completed_escrows: 0,
        disputed_escrows: 0,
        total_value: 0,
        pending_value: 0
    }
    """
