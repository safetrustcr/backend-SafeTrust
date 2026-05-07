Feature: GET /api/apartments/:id

  Background:
    * url webhookUrl
    * def validToken = karate.call('classpath:helpers/get-firebase-token.js')
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-apartments.sql'))

  Scenario: Existing ID → 200 with owner info
    Given path '/api/apartments/00000000-0000-0000-0000-000000000001'
    And header Authorization = 'Bearer ' + validToken
    When method GET
    Then status 200
    And match response.apartment.id == '00000000-0000-0000-0000-000000000001'
    And match response.apartment.owner_email == 'owner@example.com'

  Scenario: Non-existent ID → 404
    Given path '/api/apartments/00000000-0000-0000-0000-000000000999'
    And header Authorization = 'Bearer ' + validToken
    When method GET
    Then status 404
    And match response.error == 'Apartment not found'

  Scenario: No token → 401
    Given path '/api/apartments/00000000-0000-0000-0000-000000000001'
    When method GET
    Then status 401
