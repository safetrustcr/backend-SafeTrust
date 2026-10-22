Feature: Escrow analytics metric semantics (ANA-03)

# Pins the definitions in docs/analytics/metrics.md. Fixtures use 2002 dates
# and ana03- contract ids so they never overlap other features' data.

Background:
    * url baseUrl
    * header x-hasura-role = 'host'
    * eval db.execute("DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id LIKE 'ana03-%'")
    * eval db.execute("DELETE FROM safetrust.trustless_work_escrows WHERE contract_id LIKE 'ana03-%'")
    # ana03-k1 escrow.created: delivered three times over two days, processed on day 3 after retries
    # ana03-k1 escrow.funded:  delivered and processed on day 2
    # ana03-k0 escrow.created: first received before the range, redelivered on day 2
    * eval db.execute("INSERT INTO safetrust.trustless_work_webhook_events (contract_id, event_type, payload, processed, processed_at, created_at, tenant_id) VALUES ('ana03-k1', 'escrow.created', '{}', true, '2002-01-03 08:00+00', '2002-01-01 22:00+00', 'safetrust'), ('ana03-k1', 'escrow.created', '{}', false, NULL, '2002-01-01 23:00+00', 'safetrust'), ('ana03-k1', 'escrow.created', '{}', false, NULL, '2002-01-02 01:00+00', 'safetrust'), ('ana03-k1', 'escrow.funded', '{}', true, '2002-01-02 02:00+00', '2002-01-02 02:00+00', 'safetrust'), ('ana03-k0', 'escrow.created', '{}', true, '2001-12-31 10:00+00', '2001-12-31 10:00+00', 'safetrust'), ('ana03-k0', 'escrow.created', '{}', false, NULL, '2002-01-02 05:00+00', 'safetrust'), ('ana03-x1', 'escrow.created', '{}', true, '2002-01-02 05:00+00', '2002-01-02 05:00+00', 'ana03-other-tenant')")
    * eval db.execute("INSERT INTO safetrust.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, created_at, tenant_id) VALUES ('ana03-e1', 'm', 'a', 'r', 'single_release', 'funded', 'USDC', 100, '2002-01-02 10:00+00', 'safetrust'), ('ana03-e2', 'm', 'a', 'r', 'single_release', 'active', 'XLM', 999, '2002-01-02 11:00+00', 'safetrust'), ('ana03-e3', 'm', 'a', 'r', 'single_release', 'completed', 'USDC', 50, '2002-01-02 12:00+00', 'safetrust'), ('ana03-e4', 'm', 'a', 'r', 'single_release', 'resolved', 'USDC', 7, '2002-01-03 12:00+00', 'ana03-tenant'), ('ana03-e5', 'm', 'a', 'r', 'single_release', 'cancelled', 'USDC', 1000, '2002-01-03 12:00+00', 'ana03-tenant'), ('ana03-e6', 'm', 'a', 'r', 'single_release', 'pending_funding', 'USDC', 3, '2002-01-03 13:00+00', 'ana03-tenant'), ('ana03-e7', 'm', 'a', 'r', 'single_release', 'funded', 'XLM', 500, '2002-01-03 14:00+00', 'ana03-tenant')")
    * text analyticsQuery =
    """
    query GetEscrowAnalytics($start_date: date!, $end_date: date!, $tenant_id: String!) {
      getEscrowAnalyticsByDay(args: { p_start_date: $start_date, p_end_date: $end_date, p_tenant_id: $tenant_id }) {
        day webhook_records lifecycle_events processed_events escrows_created cohort_active_escrows cohort_active_value_usdc
      }
    }
    """
    Given request { query: '#(analyticsQuery)', variables: { start_date: '2002-01-01', end_date: '2002-01-03', tenant_id: 'safetrust' } }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def rows = response.data.getEscrowAnalyticsByDay
    And match rows == '#[3]'

Scenario: webhook_records counts every stored row, duplicates included
    And match karate.map(rows, function(r){ return r.webhook_records }) == [2, 3, 0]

Scenario: lifecycle_events counts each (contract_id, event_type) once, on its first received day
    # day 1: k1 created; day 2: k1 funded (k0 was first received before the range)
    And match karate.map(rows, function(r){ return r.lifecycle_events }) == [1, 1, 0]

Scenario: processed_events is bucketed by processed_at, not by when the webhook arrived
    And match karate.map(rows, function(r){ return r.processed_events }) == [0, 1, 1]

Scenario: escrow metrics are creation-cohort counts and value is USDC only
    And match rows[1] contains { escrows_created: 3, cohort_active_escrows: 2, cohort_active_value_usdc: 100 }
    And match rows[2] contains { escrows_created: 0, cohort_active_escrows: 0, cohort_active_value_usdc: 0 }

Scenario: status summary includes resolved and excludes cancelled and non-USDC value
    * header x-hasura-role = 'admin'
    Given request { query: "{ safetrust_get_escrow_status_summary(args: { tenant_id_input: \"ana03-tenant\" }) { total_escrows active_escrows total_value_usdc pending_value_usdc } }" }
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.safetrust_get_escrow_status_summary[0] == { total_escrows: 4, active_escrows: 1, total_value_usdc: 10, pending_value_usdc: 3 }
