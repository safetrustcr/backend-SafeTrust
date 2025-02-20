@ignore
Feature: Create Apartment

# Create new apartment

Background:
    * url baseUrl
    * header x-hasura-admin-secret = adminSecret
    
Scenario: Create owner and apartment

    Given path '/'
    And request
    """
    {
      "query": "mutation($id: String!, $email: String!) { 
        insert_users_one(object: { id: $id, email: $email }) { 
          id 
        } 
      }",
      "variables": {
        "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "email": "test@test.com"
      }
    }
    """
    When method POST
    Then status 200

    Given path '/'
    And request
    """
    {
      "query": "mutation($owner_id: String!, $name: String!, $price: numeric!, $warranty_deposit: numeric!, $coordinates: point!, $location_area: geometry!, $address: jsonb!, $available_from: timestamptz!) { 
        insert_apartments_one(object: { owner_id: $owner_id, name: $name, price: $price, warranty_deposit: $warranty_deposit, coordinates: $coordinates, location_area: $location_area, address: $address, available_from: $available_from }) { 
          id 
        } 
      }",
      "variables": {
        "owner_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "name": "Cozy Apartment",
        "price": 1200.00,
        "warranty_deposit": 2400.00,
        "coordinates": "40.7128,-74.0060",
        "location_area": {
          "type": "Polygon",
          "coordinates": [[[40.7128, -74.0060], [40.7129, -74.0061], [40.7130, -74.0062], [40.7128, -74.0060]]]
        },
        "address": { "street": "Main St", "city": "New York", "zip": "10001" },
        "available_from": "2025-02-02T00:00:00Z"
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.insert_apartments_one.id == '#uuid'
