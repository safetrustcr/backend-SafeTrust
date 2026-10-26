Feature: Restricted webhook and synchronization health summary

  Background:
    * url baseUrl

  Scenario: Admin can query the health summary
    Given request
      """
      {
        "query": "{ get_webhook_health_summary { pending_count failed_count oldest_unprocessed_age_minutes last_sync_at sync_lag_seconds } }"
      }
      """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.get_webhook_health_summary == '#[1]'
    And match response.data.get_webhook_health_summary[0] contains
      """
      {
        pending_count: '#number',
        failed_count: '#number',
        oldest_unprocessed_age_minutes: '##number',
        last_sync_at: '##string',
        sync_lag_seconds: '##number'
      }
      """

  Scenario: safetrust_user cannot query the health summary
    * header x-hasura-role = 'safetrust_user'
    Given request
      """
      {
        "query": "{ get_webhook_health_summary { pending_count } }"
      }
      """
    When method POST
    Then status 200
    And match response.errors == '#[1]'
    And match response.errors[0].message contains 'get_webhook_health_summary'
