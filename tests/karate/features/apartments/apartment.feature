Feature: Apartment Management

Background:
    * url baseUrl
    * header x-hasura-admin-secret = adminSecret
    * def apartment_created_response = callonce read('./create-apartment.feature')
    * def apartment_created_id = apartment_created_response["response"]["data"]["insert_apartments_one"]["id"]

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
        "id": "#(apartment_created_id)"
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
      "query": "mutation UpdateApartment($id: uuid!, $price: numeric!) {
        update_apartments_by_pk(
          pk_columns: {id: $id},
          _set: {price: $price}
        ) {
          id
          price
        }
      }",
      "variables": {
        "id": "#(apartment_created_id)",
        "price": 1300.00
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.update_apartments_by_pk.price == 1300.00

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
        "id": "#(apartment_created_id)"
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.delete_apartments_by_pk.id == "#(apartment_created_id)"
