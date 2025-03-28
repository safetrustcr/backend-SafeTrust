Feature: Apartment Images Management

Background:
    * url baseUrl
    * header x-hasura-admin-secret = 'myadminsecretkey'
    * def uuid = function() { return java.util.UUID.randomUUID() + '' } 
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      "query": "query GetApartmnet($limit: Int = 1) {
        apartments(limit: $limit) {
          id
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def apartmentId = response.data.apartments[0].id

    * def testApartmentImages =
      """
    {
      "apartment_id": #(apartmentId),
      "image_url": "https://design-milk.com/images/2024/02/Loft-M50-Turin-Paola-Mare-1.jpg",
      "uploaded_at": "2025-02-24T16:50:42.336678+00:00"
    }
    """

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
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      "query": "mutation CreateApartmentImages($object: apartment_images_insert_input!) {
        insert_apartment_images_one(object: $object) {
          id
          apartment_id
          image_url
          uploaded_at
        }
      }",
      variables: {
        object: #(testApartmentImages)
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print response.data.insert_apartment_images_one.id

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
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      "query": "mutation CreateApartmentImages($object: apartment_images_insert_input!) {
        insert_apartment_images_one(object: $object) {
          id
          apartment_id
          image_url
          uploaded_at
        }
      }",
      variables: {
        object: #(testApartmentImages)
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def apartmentImage = response.data.insert_apartment_images_one.id

    # Query with header
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "query GetApartmnetImage($id: uuid!) {
        apartment_images_by_pk(id: $id) {
          id
        }
      }",
      variables: {
        id: '#(apartmentImage)'
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print response.data.apartment_images_by_pk.id

Scenario: Update apartment image

    # Query with header
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "query GetApartmnetImage($limit: Int = 1) {
        apartment_images(limit: $limit) {
          id
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def oneApartmentImage = response.data.apartment_images[0].id

    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      "query": "mutation MyMutation($id: uuid!, $object: apartment_images_set_input!) {
        update_apartment_images_by_pk(
          pk_columns: { id: $id },  
          _set: $object           
        ) {
          apartment_id
          image_url
          uploaded_at
        }
      }",
      "variables": {
        "id": "#(oneApartmentImage)",
        "object": {
          "image_url": testApartmentImages,
          "uploaded_at": "2025-02-24T16:50:42.336678+00:00"
        }
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print response.data.update_apartment_images_by_pk.image_url

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
    # Query with header
    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      query: "query GetApartmnetImage($limit: Int = 1) {
        apartment_images(limit: $limit) {
          id
        }
      }"
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * def oneApartmentImage = response.data.apartment_images[0].id

    Given header x-hasura-admin-secret = 'myadminsecretkey'
    And request
    """
    {
      "query": "mutation DeleteApartmentImage($id: uuid!) {
        delete_apartment_images_by_pk(id: $id) {
          id
        }
      }",
      "variables": {
        "id": #(oneApartmentImage)
      }
    }
    """
    When method POST
    Then status 200
    And match response.errors == '#notpresent'
    * print response.data.delete_apartment_images_by_pk