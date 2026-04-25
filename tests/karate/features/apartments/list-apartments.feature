Feature: Apartment Listing API

Background:
    * url webhookUrl
    * def mockToken = 'mock-token'
    * header Authorization = 'Bearer ' + mockToken

Scenario: List all apartments (default)
    Given path '/api/apartments'
    When method GET
    Then status 200
    And match response.apartments == '#[]'
    And match response.total != null
    And match response.page == 1

Scenario: Filter by location
    Given path '/api/apartments'
    And param location = 'Test'
    When method GET
    Then status 200

Scenario: Filter by price range
    Given path '/api/apartments'
    And param minPrice = 500
    And param maxPrice = 2000
    When method GET
    Then status 200

Scenario: Filter by bedrooms
    Given path '/api/apartments'
    And param bedrooms = 2
    When method GET
    Then status 200

Scenario: Filter by pet friendly
    Given path '/api/apartments'
    And param petFriendly = 'true'
    When method GET
    Then status 200

Scenario: Pagination test
    Given path '/api/apartments'
    And param page = 2
    And param limit = 5
    When method GET
    Then status 200
    And match response.page == 2

Scenario: Sorting by price ascending
    Given path '/api/apartments'
    And param sortBy = 'price_asc'
    When method GET
    Then status 200

Scenario: Invalid token returns 401
    Given path '/api/apartments'
    And header Authorization = 'Bearer invalid'
    When method GET
    Then status 401
