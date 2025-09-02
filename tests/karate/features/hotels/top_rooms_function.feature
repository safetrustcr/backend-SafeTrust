Feature: Top Rooms by Reservations Function Tests

Background:
    * url baseUrl
    * print '=== Loading top_rooms_function feature file ==='
    * print 'URL set to:', baseUrl
    * header x-hasura-admin-secret = adminSecret

Scenario: Test function with default parameters (all time, no status filter)
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_top_rooms_by_reservations == '#array'

Scenario: Test function with week time period
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations(args: {time_period: \"week\"}) { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_top_rooms_by_reservations == '#array'

Scenario: Test function with month time period
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations(args: {time_period: \"month\"}) { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_top_rooms_by_reservations == '#array'

Scenario: Test function with year time period
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations(args: {time_period: \"year\"}) { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_top_rooms_by_reservations == '#array'

Scenario: Test function with status filter
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations(args: {time_period: \"all\", filter_status: \"CONFIRMED\"}) { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_top_rooms_by_reservations == '#array'

Scenario: Test function with invalid time period should fail
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations(args: {time_period: \"invalid\"}) { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.errors != null
    And match response.errors[0].message contains 'Invalid time_period'

Scenario: Test function returns correct structure and top 5 limit
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations(args: {time_period: \"all\"}) { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_top_rooms_by_reservations == '#array'
    # Verify that it returns at most 5 rows
    And assert response.data.get_top_rooms_by_reservations.length <= 5
    # Verify each row has the expected columns
    And match each response.data.get_top_rooms_by_reservations contains { room_id: '#string', room_number: '#string', hotel_name: '#string', reservation_count: '#number', total_revenue: '#number' }

Scenario: Test function with all parameters
    Given request 
    """
    {
        "query": "query { get_top_rooms_by_reservations(args: {time_period: \"month\", filter_status: \"CONFIRMED\"}) { room_id room_number hotel_name reservation_count total_revenue } }",
        "variables": {}
    }
    """
    When method POST
    Then status 200
    And match response.data != null
    And match response.data.get_top_rooms_by_reservations == '#array'