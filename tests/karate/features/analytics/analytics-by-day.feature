Feature: Escrow Analytics by Day GraphQL Contract and Edge Cases

Background:
    * url baseUrl
    * header x-hasura-admin-secret = adminSecret
    * configure logPrettyRequest = true
    * configure logPrettyResponse = true

    # Clean test fixtures after completion
    * configure afterScenario = function(){ db.execute(karate.read('file:tests/fixtures/analytics/clean-analytics.sql')); }

Scenario: Contract - get_escrow_analytics_by_day field names and types
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-analytics-standard.sql'))
    Given request
    """
    {
        "query": "query GetAnalytics($startDate: timestamptz!, $endDate: timestamptz!, $tenant: String!) { get_escrow_analytics_by_day(args: {start_date: $startDate, end_date: $endDate, tenant_id_input: $tenant}) { day event_count processed_count new_users active_escrows escrow_value } }",
        "variables": {
            "startDate": "2026-10-01T00:00:00Z",
            "endDate": "2026-10-05T00:00:00Z",
            "tenant": "safetrust"
        }
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_analytics_by_day == '#array'
    And assert response.data.get_escrow_analytics_by_day.length == 5
    # Verify field types per row
    And match each response.data.get_escrow_analytics_by_day contains
    """
    {
        day: '#regex ^\\d{4}-\\d{2}-\\d{2}$',
        event_count: '#number',
        processed_count: '#number',
        new_users: '#number',
        active_escrows: '#number',
        escrow_value: '#number'
    }
    """
    # Verify baseline metrics per ANA-03 definitions
    And match response.data.get_escrow_analytics_by_day[0] == { day: '2026-10-01', event_count: 2, processed_count: 1, new_users: 1, active_escrows: 1, escrow_value: 1000 }
    And match response.data.get_escrow_analytics_by_day[1] == { day: '2026-10-02', event_count: 3, processed_count: 3, new_users: 2, active_escrows: 1, escrow_value: 500 }
    And match response.data.get_escrow_analytics_by_day[2] == { day: '2026-10-03', event_count: 0, processed_count: 0, new_users: 0, active_escrows: 1, escrow_value: 750 }
    And match response.data.get_escrow_analytics_by_day[3] == { day: '2026-10-04', event_count: 1, processed_count: 1, new_users: 0, active_escrows: 0, escrow_value: 0 }
    And match response.data.get_escrow_analytics_by_day[4] == { day: '2026-10-05', event_count: 1, processed_count: 1, new_users: 0, active_escrows: 0, escrow_value: 0 }

Scenario: Diagram 1 - Zero-filled days when no events exist in range
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-zero-fill.sql'))
    Given request
    """
    {
        "query": "query GetZeroFill($startDate: timestamptz!, $endDate: timestamptz!) { get_escrow_analytics_by_day(args: {start_date: $startDate, end_date: $endDate, tenant_id_input: \"safetrust\"}) { day event_count processed_count new_users active_escrows escrow_value } }",
        "variables": {
            "startDate": "2026-11-01T00:00:00Z",
            "endDate": "2026-11-05T00:00:00Z"
        }
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_analytics_by_day == '#[5]'
    # Ensure all days are present, all counts are 0, and no null values exist
    And match each response.data.get_escrow_analytics_by_day contains { event_count: 0, processed_count: 0, new_users: 0, active_escrows: 0, escrow_value: 0 }
    And match response.data.get_escrow_analytics_by_day[0].day == '2026-11-01'
    And match response.data.get_escrow_analytics_by_day[4].day == '2026-11-05'

Scenario: Diagram 1 - Duplicate delivery event_count deduplication semantics
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-duplicate-delivery.sql'))
    Given request
    """
    {
        "query": "query GetDupEvents($startDate: timestamptz!, $endDate: timestamptz!) { get_escrow_analytics_by_day(args: {start_date: $startDate, end_date: $endDate, tenant_id_input: \"safetrust\"}) { day event_count processed_count active_escrows escrow_value } }",
        "variables": {
            "startDate": "2026-10-12T00:00:00Z",
            "endDate": "2026-10-12T00:00:00Z"
        }
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_analytics_by_day == '#[1]'
    # Total received delivery events = 2, deduped processed count = 1, unique active escrow = 1
    And match response.data.get_escrow_analytics_by_day[0] == { day: '2026-10-12', event_count: 2, processed_count: 1, active_escrows: 1, escrow_value: 350 }

Scenario: Diagram 1 - Multi-asset escrow aggregation
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-multi-asset.sql'))
    Given request
    """
    {
        "query": "query GetMultiAsset($startDate: timestamptz!, $endDate: timestamptz!) { get_escrow_analytics_by_day(args: {start_date: $startDate, end_date: $endDate, tenant_id_input: \"safetrust\"}) { day active_escrows escrow_value } }",
        "variables": {
            "startDate": "2026-10-15T00:00:00Z",
            "endDate": "2026-10-15T00:00:00Z"
        }
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_analytics_by_day == '#[1]'
    # 2 active escrows (funded USDC 500 + active XLM 250), escrow_value = 750
    And match response.data.get_escrow_analytics_by_day[0] == { day: '2026-10-15', active_escrows: 2, escrow_value: 750 }

Scenario: Diagram 3 - Inverted date range (start > end) returns empty or error
    Given request
    """
    {
        "query": "query InvertedRange($startDate: timestamptz!, $endDate: timestamptz!) { get_escrow_analytics_by_day(args: {start_date: $startDate, end_date: $endDate, tenant_id_input: \"safetrust\"}) { day event_count } }",
        "variables": {
            "startDate": "2026-10-15T00:00:00Z",
            "endDate": "2026-10-01T00:00:00Z"
        }
    }
    """
    When method POST
    Then status 200
    # SQL generate_series returns 0 rows when start > end without throwing an unhandled database exception
    And match response.data != null
    And match response.data.get_escrow_analytics_by_day == '#[0]'

Scenario: Diagram 3 - Oversized date range (> 365 days) handling
    Given request
    """
    {
        "query": "query OversizedRange($startDate: timestamptz!, $endDate: timestamptz!) { get_escrow_analytics_by_day(args: {start_date: $startDate, end_date: $endDate, tenant_id_input: \"safetrust\"}) { day event_count } }",
        "variables": {
            "startDate": "2025-01-01T00:00:00Z",
            "endDate": "2026-02-15T00:00:00Z"
        }
    }
    """
    When method POST
    Then status 200
    # Boundary check: returns valid array without memory crash or timeout
    And match response.data != null
    And match response.data.get_escrow_analytics_by_day == '#array'
    And assert response.data.get_escrow_analytics_by_day.length > 365

Scenario: Diagram 3 - Timezone boundary day buckets (midnight UTC vs CR)
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-boundary-ranges.sql'))
    Given request
    """
    {
        "query": "query TimezoneBoundary($startDate: timestamptz!, $endDate: timestamptz!) { get_escrow_analytics_by_day(args: {start_date: $startDate, end_date: $endDate, tenant_id_input: \"safetrust\"}) { day event_count active_escrows escrow_value } }",
        "variables": {
            "startDate": "2026-10-20T00:00:00Z",
            "endDate": "2026-10-21T00:00:00Z"
        }
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_analytics_by_day == '#[2]'
    # Day 1: 2026-10-20 (event at 23:30:00 UTC)
    And match response.data.get_escrow_analytics_by_day[0] == { day: '2026-10-20', event_count: 1, active_escrows: 1, escrow_value: 100 }
    # Day 2: 2026-10-21 (event at 00:30:00 UTC)
    And match response.data.get_escrow_analytics_by_day[1] == { day: '2026-10-21', event_count: 1, active_escrows: 1, escrow_value: 200 }
