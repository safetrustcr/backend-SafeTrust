Feature: Apartment Management

Background:
    * url baseUrl
    * print '=== Loading feature file ==='
    * print 'URL set to:', baseUrl
    * header x-hasura-admin-secret = adminSecret

# Check GraphQL endpoint health
Scenario: Check GraphQL endpoint health
    Given path '/'
    And request { query: "query { __typename }" }
    When method POST
    Then status 200
    And match response == { data: { __typename: 'query_root' } }

# Check apartments schema
Scenario: Check apartments schema
    Given path '/'
    And request
    """
    {
      "query": "query { __type(name: \"apartments\") { name fields { name type { name kind } } } }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print 'Schema:', response.data.__type

# Create new apartment
Scenario: Create new apartment
    Given path '/'
    And request
    """
    {
      "query": "mutation($owner_id: String!, $name: String!, $price: Float!, $warranty_deposit: Float!, $coordinates: point!, $location_area: geometry!, $address: jsonb!, $available_from: timestamptz!) { 
        insert_apartments_one(object: { owner_id: $owner_id, name: $name, price: $price, warranty_deposit: $warranty_deposit, coordinates: $coordinates, location_area: $location_area, address: $address, available_from: $available_from }) { 
          id 
        } 
      }",
      "variables": {
        "owner_id": "user-123",
        "name": "Cozy Apartment",
        "price": 1200.00,
        "warranty_deposit": 2400.00,
        "coordinates": { "x": 40.7128, "y": -74.0060 },
        "location_area": "POLYGON((...))",
        "address": { "street": "Main St", "city": "New York", "zip": "10001" },
        "available_from": "2025-02-02T00:00:00Z"
      }
    }
    """
    When method POST
    Then status 201
    And match response.errors == '#notpresent'
    * def created_id = response.data.insert_apartments_one.id

# Query apartment by ID
Scenario: Query apartment by ID
    Given path '/'
    And request
    """
    {
      "query": "query GetApartment($id: uuid!) {
        apartments_by_pk(id: $id) {
          id
          name
          price
          warranty_deposit
          coordinates
          location_area
          address
          available_from
          created_at
        }
      }",
      "variables": {
        "id": "#(created_id)"
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.apartments_by_pk != null

# Update apartment details
Scenario: Update apartment details
    Given path '/'
    And request
    """
    {
      "query": "mutation UpdateApartment($id: uuid!, $price: Float!) {
        update_apartments_by_pk(
          pk_columns: {id: $id},
          _set: {price: $price}
        ) {
          id
          price
        }
      }",
      "variables": {
        "id": "#(created_id)",
        "price": 1300.00
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.update_apartments_by_pk.price == 1300.00

# Delete apartment
Scenario: Delete apartment
    Given path '/'
    And request
    """
    {
      "query": "mutation DeleteApartment($id: uuid!) {
        delete_apartments_by_pk(id: $id) {
          id
        }
      }",
      "variables": {
        "id": "#(created_id)"
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.delete_apartments_by_pk.id == "#(created_id)"

# List apartments
Scenario: List apartments
    Given path '/'
    And request
    """
    {
      "query": "query ListApartments {
        apartments(limit: 10, order_by: {created_at: desc}) {
          id
          name
          price
          available_from
          created_at
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.apartments != null
    And match response.data.apartments == '#[_ > 0]'
