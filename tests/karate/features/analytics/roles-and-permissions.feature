Feature: Role-Aware Access Control and Tenant Isolation for Analytics

Background:
    * url baseUrl
    * header x-hasura-admin-secret = adminSecret
    * configure logPrettyRequest = true
    * configure logPrettyResponse = true

    # Clean test fixtures after completion
    * configure afterScenario = function(){ db.execute(karate.read('file:tests/fixtures/analytics/clean-analytics.sql')); }

Scenario: Diagram 2 - Admin role is permitted to query any tenant
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-tenants-roles.sql'))
    
    # 1. Admin queries safetrust tenant
    Given request
    """
    {
        "query": "query AdminQuerySafeTrust { get_escrow_status_summary(args: {tenant_id_input: \"safetrust\"}) { total_escrows active_escrows total_value } }"
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_status_summary[0] == { total_escrows: 1, active_escrows: 1, total_value: 1000 }

    # 2. Admin queries hotel_industry tenant
    Given request
    """
    {
        "query": "query AdminQueryHotel { get_escrow_status_summary(args: {tenant_id_input: \"hotel_industry\"}) { total_escrows active_escrows total_value } }"
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_escrow_status_summary[0] == { total_escrows: 1, active_escrows: 1, total_value: 8888 }

Scenario: Diagram 2 - safetrust_user role accessing own tenant sees own data only
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-tenants-roles.sql'))
    * header x-hasura-role = 'safetrust_user'
    * header x-hasura-user-id = 'test-ana-user-st'
    * header x-hasura-tenant-id = 'safetrust'

    Given request
    """
    {
        "query": "query UserOwnTenant { get_escrow_status_summary(args: {tenant_id_input: \"safetrust\"}) { total_escrows active_escrows total_value } }"
    }
    """
    When method POST
    Then status 200
    # Own-tenant access must succeed without errors and show own data only
    And match response.errors == '#notpresent'
    And match response.data != null
    And match response.data.get_escrow_status_summary[0] == { total_escrows: 1, active_escrows: 1, total_value: 1000 }

Scenario: Diagram 2 - safetrust_user role querying another tenant returns own data or authorization error
    * db.execute(karate.read('file:tests/fixtures/analytics/seed-tenants-roles.sql'))
    * header x-hasura-role = 'safetrust_user'
    * header x-hasura-user-id = 'test-ana-user-st'
    * header x-hasura-tenant-id = 'safetrust'

    Given request
    """
    {
        "query": "query UserOtherTenant { get_escrow_status_summary(args: {tenant_id_input: \"hotel_industry\"}) { total_escrows active_escrows total_value } }"
    }
    """
    When method POST
    Then status 200
    # Tenant boundary invariant: cross-tenant query must return an authorization error
    # or an allowed isolated result (0 or own-tenant 1000), strictly rejecting foreign values
    And assert (response.errors != null) || (response.data != null && (response.data.get_escrow_status_summary[0].total_value == 0 || response.data.get_escrow_status_summary[0].total_value == 1000))

Scenario: Diagram 2 - Anonymous role request is rejected (missing credentials)
    # Clear admin secret header to simulate unauthenticated/anonymous client
    * configure headers = { 'Content-Type': 'application/json' }

    Given request
    """
    {
        "query": "query AnonymousQuery { get_escrow_status_summary { total_escrows } }"
    }
    """
    When method POST
    Then assert responseStatus == 401 || (response.errors != null && response.errors.length > 0)

Scenario: Diagram 2 - Explicit anonymous role impersonation is rejected by GraphQL engine
    * configure headers = { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret, 'x-hasura-role': 'anonymous' }

    Given request
    """
    {
        "query": "query AnonymousExplicit { get_escrow_status_summary { total_escrows } }"
    }
    """
    When method POST
    Then status 200
    And match response.errors != null
    And match response.errors[0].message contains 'not found'
