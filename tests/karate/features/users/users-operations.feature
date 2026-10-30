Feature: users GraphQL operations exist under their original names (issue #666)

# The schema move (migration 1779300000001) puts users in the `safetrust`
# schema. Hasura then exposes it as `safetrust_users` unless the table has a
# custom_name, which silently removes `users` from every client. This pins the
# original contract.

Background:
    * url baseUrl
    * header x-hasura-admin-secret = adminSecret

Scenario: query_root exposes users and users_by_pk
    Given request { query: "{ __type(name: \"query_root\") { fields { name } } }" }
    When method POST
    Then status 200
    And match response.data.__type.fields[*].name contains ['users', 'users_by_pk', 'users_aggregate']

Scenario: query_root does not expose the schema-prefixed name
    Given request { query: "{ __type(name: \"query_root\") { fields { name } } }" }
    When method POST
    Then status 200
    And match response.data.__type.fields[*].name !contains 'safetrust_users'

Scenario: mutation_root exposes the users mutations
    Given request { query: "{ __type(name: \"mutation_root\") { fields { name } } }" }
    When method POST
    Then status 200
    And match response.data.__type.fields[*].name contains ['insert_users', 'update_users', 'update_users_by_pk']
