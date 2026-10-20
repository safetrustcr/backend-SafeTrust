Feature: Escrow analytics GraphQL contract (ANA-01)

# Guards the contract the dashboard calls:
#   getEscrowAnalyticsByDay(args: {p_start_date: date, p_end_date: date, p_tenant_id: String})
# backed by safetrust.get_escrow_analytics_by_day(date, date, varchar).

Background:
    * url baseUrl
    * header x-hasura-role = 'host'
    * eval db.execute("DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id LIKE 'ana01-%'")
    * eval db.execute("INSERT INTO safetrust.trustless_work_webhook_events (contract_id, event_type, payload, processed, created_at, tenant_id) VALUES ('ana01-c1', 'escrow.created', '{}', true, '2001-01-02 23:30+00', 'safetrust'), ('ana01-c1', 'escrow.created', '{}', false, '2001-01-02 10:00+00', 'safetrust'), ('ana01-c2', 'escrow.funded', '{}', true, '2001-01-03 00:10+00', 'safetrust')")
    * text analyticsQuery =
    """
    query GetEscrowAnalytics($start_date: date!, $end_date: date!, $tenant_id: String!) {
      getEscrowAnalyticsByDay(args: { p_start_date: $start_date, p_end_date: $end_date, p_tenant_id: $tenant_id }) {
        day webhook_records lifecycle_events processed_events last_active_users escrows_created cohort_active_escrows cohort_active_value_usdc
      }
    }
    """

Scenario: host role introspection exposes getEscrowAnalyticsByDay with the aligned arguments
    Given request { query: "{ __schema { queryType { fields { name } } } __type(name: \"getEscrowAnalyticsByDay_args\") { inputFields { name type { name } } } }" }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def rootNames = karate.map(response.data.__schema.queryType.fields, function(f){ return f.name })
    And match rootNames contains 'getEscrowAnalyticsByDay'
    And match rootNames !contains 'get_escrow_analytics_by_day'
    And match rootNames !contains 'escrow_analytics_by_day'
    And match response.data.__type.inputFields contains only
    """
    [
      { name: 'p_start_date', type: { name: 'date' } },
      { name: 'p_end_date', type: { name: 'date' } },
      { name: 'p_tenant_id', type: { name: 'String' } }
    ]
    """

Scenario: the dashboard operation returns one row per UTC day in the range
    Given request { query: '#(analyticsQuery)', variables: { start_date: '2001-01-01', end_date: '2001-01-03', tenant_id: 'safetrust' } }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def rows = response.data.getEscrowAnalyticsByDay
    And match rows == '#[3]'
    And match each rows contains { day: '#string', webhook_records: '#number', lifecycle_events: '#number', processed_events: '#number', last_active_users: '#number', escrows_created: '#number', cohort_active_escrows: '#number', cohort_active_value_usdc: '#number' }
    And match karate.map(rows, function(r){ return r.day }) == ['2001-01-01', '2001-01-02', '2001-01-03']
    # 23:30Z stays on 2001-01-02 and 00:10Z lands on 2001-01-03 regardless of server time zone
    And match rows[1] contains { webhook_records: 2 }
    And match rows[2] contains { webhook_records: 1 }

Scenario: omitting p_tenant_id is a schema error, not a silent default
    Given request { query: "{ getEscrowAnalyticsByDay(args: { p_start_date: \"2001-01-01\", p_end_date: \"2001-01-03\" }) { day } }" }
    When method POST
    Then status 200
    And match response.data == '#notpresent'
    And match response.errors[0].message contains 'cannot be omitted'

Scenario: a non-string p_tenant_id is rejected at parse time
    Given request { query: "{ getEscrowAnalyticsByDay(args: { p_start_date: \"2001-01-01\", p_end_date: \"2001-01-03\", p_tenant_id: 42 }) { day } }" }
    When method POST
    Then status 200
    And match response.data == '#notpresent'
    And match response.errors[0].extensions.code == 'parse-failed'

Scenario: a blank p_tenant_id is rejected by the function
    Given request { query: '#(analyticsQuery)', variables: { start_date: '2001-01-01', end_date: '2001-01-03', tenant_id: '' } }
    When method POST
    Then status 200
    And match response.errors[0].message contains 'p_tenant_id are required'

Scenario: an inverted date range is rejected
    Given request { query: '#(analyticsQuery)', variables: { start_date: '2001-01-03', end_date: '2001-01-01', tenant_id: 'safetrust' } }
    When method POST
    Then status 200
    And match response.errors[0].message contains 'must not be before'

Scenario: roles without an execution permission do not see the root field
    * header x-hasura-role = 'guest'
    Given request { query: '#(analyticsQuery)', variables: { start_date: '2001-01-01', end_date: '2001-01-03', tenant_id: 'safetrust' } }
    When method POST
    Then status 200
    And match response.errors[0].extensions.code == 'validation-failed'
