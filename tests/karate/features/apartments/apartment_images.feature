Feature: Apartment Images Management

Background:
    * url baseUrl
    * print '=== Loading feature file ==='
    * print 'URL set to:', baseUrl
    * header x-hasura-admin-secret = adminSecret

Scenario: Check GraphQL endpoint health
    Given path '/'
    And request { query: "query { __typename }" }
    When method POST
    Then status 200
    And match response == { data: { __typename: 'query_root' } }

Scenario: Check apartment_images schema
    Given path '/'
    And request
    """
    {
      "query": "query { __type(name: \"apartment_images\") { name fields { name type { name kind } } } }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print 'Schema:', response.data.__type

Scenario: Create new apartment image
    Given path '/'
    And request
    """
    {
      "query": "mutation($apartment_id: uuid!, $image_url: String!) { insert_apartment_images_one(object: { apartment_id: $apartment_id, image_url: $image_url }) { id } }",
      "variables": {
        "apartment_id": "11111111-1111-1111-1111-111111111111",
        "image_url": "https://example.com/test-image.jpg"
      }
    }
    """
    When method POST
    Then status 201
    And match response.errors == '#notpresent'
    * def created_id = response.data.insert_apartment_images_one.id

Scenario: Verify apartment_images schema exists
    Given path '/'
    And request
    """
    {
      "query": "query {
        __type(name: \"apartment_images\") {
          name
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.data.__type != null
    * print 'Schema:', response.data.__type

Scenario: Verify mutations are available
    Given path '/'
    And request
    """
    {
      "query": "query {
        __schema {
          mutationType {
            fields {
              name
            }
          }
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.data.__schema.mutationType != null
    * print 'Available mutations:', response.data.__schema.mutationType.fields

Scenario: Verify query permissions
    Given path '/'
    And request
    """
    {
      "query": "query {
        __schema {
          queryType {
            fields {
              name
              description
            }
          }
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.data.__schema.queryType != null
    * print 'Available queries:', response.data.__schema.queryType.fields

Scenario: Verify apartment_images table exists
    Given path '/'
    And request
    """
    {
      "query": "query {
        __type(name: \"apartment_images\") {
          name
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print 'Schema:', response.data.__type

Scenario: Query apartment image by ID
    Given path '/'
    And request
    """
    {
      "query": "query GetApartmentImage($id: uuid!) {
        apartment_images_by_pk(id: $id) {
          id
          image_url
          apartment_id
          uploaded_at
        }
      }",
      "variables": {
        "id": "11111111-1111-1111-1111-111111111111"
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.apartment_images_by_pk != null

Scenario: Update apartment image
    Given path '/'
    And request
    """
    {
      "query": "mutation UpdateApartmentImage($id: uuid!, $image_url: String!) {
        update_apartment_images_by_pk(
          pk_columns: {id: $id},
          _set: {image_url: $image_url}
        ) {
          id
          image_url
          uploaded_at
        }
      }",
      "variables": {
        "id": "11111111-1111-1111-1111-111111111111",
        "image_url": "https://example.com/updated-image.jpg"
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.update_apartment_images_by_pk.image_url == 'https://example.com/updated-image.jpg'

Scenario: List apartment images
    Given path '/'
    And request
    """
    {
      "query": "query ListApartmentImages {
        apartment_images(limit: 10, order_by: {uploaded_at: desc}) {
          id
          image_url
          apartment_id
          uploaded_at
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    And match response.data.apartment_images != null
    And match response.data.apartment_images == '#[_ > 0]'

Scenario: Delete apartment image
    Given path '/'
    And request
    """
    {
      "query": "mutation DeleteApartmentImage($id: uuid!) {
        delete_apartment_images_by_pk(id: $id) {
          id
        }
      }",
      "variables": {
        "id": "11111111-1111-1111-1111-111111111111"
      }
    }
    """
    When method POST
    Then status 204
    And match response.errors == '#notpresent'
    And match response.data.delete_apartment_images_by_pk != null 