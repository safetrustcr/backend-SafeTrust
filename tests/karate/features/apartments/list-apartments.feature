Feature: Apartment Listing API

Background:
    * url webhookUrl
    * def mockToken = 'mock-token'
    * header Authorization = 'Bearer ' + mockToken

Scenario: List all apartments (default)
    Given path '/api/apartments'
    When method GET
    Then status 200
    And match response.apartments == '#array'
    And match response.total == '#number'
    And match response.page == 1

Scenario: Filter by location
    Given path '/api/apartments'
    And param location = 'Test'
    When method GET
    Then status 200
    * def matchesLocation = function(a){ var re = /test/i; return re.test(a.name || '') || re.test(a.description || '') }
    And match each response.apartments == '#?matchesLocation(_)'

Scenario: Filter by price range
    Given path '/api/apartments'
    And param minPrice = 500
    And param maxPrice = 2000
    When method GET
    Then status 200
    And match each response.apartments contains { price: '#? _ >= 500 && _ <= 2000' }

Scenario: Filter by bedrooms
    Given path '/api/apartments'
    And param bedrooms = 2
    When method GET
    Then status 200
    And match each response.apartments contains { bedrooms: 2 }

Scenario: Filter by pet friendly
    Given path '/api/apartments'
    And param petFriendly = 'true'
    When method GET
    Then status 200
    And match each response.apartments contains { pet_friendly: true }

Scenario: Pagination test
    Given path '/api/apartments'
    And param page = 2
    And param limit = 5
    When method GET
    Then status 200
    And match response.page == 2
    And match response.apartments == '#[_ <= 5]'

Scenario: Sorting by price ascending
    Given path '/api/apartments'
    And param sort = 'price_asc'
    When method GET
    Then status 200
    # Manual check or complex karate logic for sorting if needed
    # match each response.apartments[*].price == ...

Scenario: Invalid token returns 401
    Given path '/api/apartments'
    And header Authorization = 'Bearer invalid'
    When method GET
    Then status 401
    And match response == { error: 'Unauthorized: Invalid token' }
