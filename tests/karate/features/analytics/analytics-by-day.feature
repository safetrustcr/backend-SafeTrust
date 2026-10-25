Feature: Escrow Analytics by Day GraphQL Contract and Edge Cases

Background:
    * url baseUrl
    * header x-hasura-admin-secret = adminSecret
    * configure logPrettyRequest = true
    * configure logPrettyResponse = true

    # Clean test fixtures after completion
    * configure afterScenario = function(){ db.execute(karate.read('file:tests/fixtures/analytics/clean-analytics.sql')); }

Scenario: Contract - getEscrowAnalyticsByDay field names and types
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-analytics-standard.sql'))
    Given request
    """
    {
        "query": "query GetAnalytics($startDate: date!, $endDate: date!, $tenant: String!) { getEscrowAnalyticsByDay(args: {p_start_date: $startDate, p_end_date: $endDate, p_tenant_id: $tenant}) { day webhook_records lifecycle_events processed_events last_active_users escrows_created cohort_active_escrows cohort_active_value_usdc } }",
        "variables": {
            "startDate": "2026-10-01",
            "endDate": "2026-10-05",
            "tenant": "safetrust"
        }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data != null
    And match response.data.getEscrowAnalyticsByDay == '#array'
    And assert response.data.getEscrowAnalyticsByDay.length == 5
    # Verify field types per row
    And match each response.data.getEscrowAnalyticsByDay contains
    """
    {
        day: '#regex ^\\d{4}-\\d{2}-\\d{2}$',
        webhook_records: '#number',
        lifecycle_events: '#number',
        processed_events: '#number',
        last_active_users: '#number',
        escrows_created: '#number',
        cohort_active_escrows: '#number',
        cohort_active_value_usdc: '#number'
    }
    """
    # Verify baseline metrics per ANA-03 definitions
    And match response.data.getEscrowAnalyticsByDay[0] == { day: '2026-10-01', webhook_records: 2, lifecycle_events: 2, processed_events: 1, last_active_users: 1, escrows_created: 1, cohort_active_escrows: 1, cohort_active_value_usdc: 1000 }
    And match response.data.getEscrowAnalyticsByDay[1] == { day: '2026-10-02', webhook_records: 3, lifecycle_events: 3, processed_events: 3, last_active_users: 2, escrows_created: 1, cohort_active_escrows: 1, cohort_active_value_usdc: 500 }
    And match response.data.getEscrowAnalyticsByDay[2] == { day: '2026-10-03', webhook_records: 0, lifecycle_events: 0, processed_events: 0, last_active_users: 0, escrows_created: 1, cohort_active_escrows: 1, cohort_active_value_usdc: 750 }
    And match response.data.getEscrowAnalyticsByDay[3] == { day: '2026-10-04', webhook_records: 1, lifecycle_events: 1, processed_events: 1, last_active_users: 0, escrows_created: 1, cohort_active_escrows: 0, cohort_active_value_usdc: 0 }
    And match response.data.getEscrowAnalyticsByDay[4] == { day: '2026-10-05', webhook_records: 1, lifecycle_events: 1, processed_events: 1, last_active_users: 0, escrows_created: 2, cohort_active_escrows: 0, cohort_active_value_usdc: 0 }

Scenario: Diagram 1 - Zero-filled days when no events exist in range
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-zero-fill.sql'))
    Given request
    """
    {
        "query": "query GetZeroFill($startDate: date!, $endDate: date!) { getEscrowAnalyticsByDay(args: {p_start_date: $startDate, p_end_date: $endDate, p_tenant_id: \"safetrust\"}) { day webhook_records lifecycle_events processed_events last_active_users escrows_created cohort_active_escrows cohort_active_value_usdc } }",
        "variables": {
            "startDate": "2035-01-01",
            "endDate": "2035-01-05"
        }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data != null
    And match response.data.getEscrowAnalyticsByDay == '#[5]'
    # Ensure all days are present, all counts are 0, and no null values exist
    And match each response.data.getEscrowAnalyticsByDay contains { webhook_records: 0, lifecycle_events: 0, processed_events: 0, last_active_users: 0, escrows_created: 0, cohort_active_escrows: 0, cohort_active_value_usdc: 0 }
    And match response.data.getEscrowAnalyticsByDay[0].day == '2035-01-01'
    And match response.data.getEscrowAnalyticsByDay[4].day == '2035-01-05'

Scenario: Diagram 1 - Duplicate delivery event_count deduplication semantics
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-duplicate-delivery.sql'))
    Given request
    """
    {
        "query": "query GetDupEvents($startDate: date!, $endDate: date!) { getEscrowAnalyticsByDay(args: {p_start_date: $startDate, p_end_date: $endDate, p_tenant_id: \"safetrust\"}) { day webhook_records lifecycle_events processed_events cohort_active_escrows cohort_active_value_usdc } }",
        "variables": {
            "startDate": "2026-10-12",
            "endDate": "2026-10-12"
        }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data != null
    And match response.data.getEscrowAnalyticsByDay == '#[1]'
    # Total received delivery events = 2, unique lifecycle event = 1, processed count = 1, unique active escrow = 1
    And match response.data.getEscrowAnalyticsByDay[0] == { day: '2026-10-12', webhook_records: 2, lifecycle_events: 1, processed_events: 1, cohort_active_escrows: 1, cohort_active_value_usdc: 350 }

Scenario: Diagram 1 - Multi-asset escrow aggregation (USDC single-asset policy)
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-multi-asset.sql'))
    Given request
    """
    {
        "query": "query GetMultiAsset($startDate: date!, $endDate: date!) { getEscrowAnalyticsByDay(args: {p_start_date: $startDate, p_end_date: $endDate, p_tenant_id: \"safetrust\"}) { day cohort_active_escrows cohort_active_value_usdc } }",
        "variables": {
            "startDate": "2026-10-15",
            "endDate": "2026-10-15"
        }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data != null
    And match response.data.getEscrowAnalyticsByDay == '#[1]'
    # 2 active escrows (funded USDC 500 + active XLM 250), single-asset USDC value = 500
    And match response.data.getEscrowAnalyticsByDay[0] == { day: '2026-10-15', cohort_active_escrows: 2, cohort_active_value_usdc: 500 }

Scenario: Diagram 3 - Inverted date range (start > end) returns validation error
    Given request
    """
    {
        "query": "query InvertedRange($startDate: date!, $endDate: date!) { getEscrowAnalyticsByDay(args: {p_start_date: $startDate, p_end_date: $endDate, p_tenant_id: \"safetrust\"}) { day webhook_records } }",
        "variables": {
            "startDate": "2026-10-15",
            "endDate": "2026-10-01"
        }
    }
    """
    When method POST
    Then status 200
    And match response.errors != null
    And match response.errors[0].message contains 'must not be before'

Scenario: Diagram 3 - Oversized date range (> 366 days) returns validation error
    Given request
    """
    {
        "query": "query OversizedRange($startDate: date!, $endDate: date!) { getEscrowAnalyticsByDay(args: {p_start_date: $startDate, p_end_date: $endDate, p_tenant_id: \"safetrust\"}) { day webhook_records } }",
        "variables": {
            "startDate": "2025-01-01",
            "endDate": "2026-02-15"
        }
    }
    """
    When method POST
    Then status 200
    And match response.errors != null
    And match response.errors[0].message contains 'must not exceed'

Scenario: Diagram 3 - Timezone boundary day buckets (midnight UTC vs CR)
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-boundary-ranges.sql'))
    Given request
    """
    {
        "query": "query TimezoneBoundary($startDate: date!, $endDate: date!) { getEscrowAnalyticsByDay(args: {p_start_date: $startDate, p_end_date: $endDate, p_tenant_id: \"safetrust\"}) { day webhook_records cohort_active_escrows cohort_active_value_usdc } }",
        "variables": {
            "startDate": "2026-10-20",
            "endDate": "2026-10-21"
        }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data != null
    And match response.data.getEscrowAnalyticsByDay == '#[2]'
    # Day 1: 2026-10-20 (event at 23:30:00 UTC)
    And match response.data.getEscrowAnalyticsByDay[0] == { day: '2026-10-20', webhook_records: 1, cohort_active_escrows: 1, cohort_active_value_usdc: 100 }
    # Day 2: 2026-10-21 (event at 00:30:00 UTC)
    And match response.data.getEscrowAnalyticsByDay[1] == { day: '2026-10-21', webhook_records: 1, cohort_active_escrows: 1, cohort_active_value_usdc: 200 }
