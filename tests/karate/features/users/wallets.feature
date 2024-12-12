Feature: User Wallets

Background:
    * url baseUrl
    * print '=== Loading feature file ==='
    * print 'URL set to:', baseUrl

Scenario: Get schema information
    Given header Authorization = tokenHelper({ role: 'admin' })
    And header x-hasura-admin-secret = adminSecret
    And request
    """
    {
      "query": "
        query IntrospectionQuery {
          __schema {
            queryType {
              fields {
                name
                description
              }
            }
          }
        }
      "
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print 'Available queries:', response.data.__schema.queryType.fields 