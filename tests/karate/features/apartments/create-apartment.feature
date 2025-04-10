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
      "query": "mutation insert_new_user(  	
        $id: String!, 
  	    $email: String!, 
  	    $first_name: String!,
		    $last_name: String!,
  	    $is_email_verified: Boolean,
  	    $last_seen: timestamptz,
  	    $last_verification: timestamptz,
        $location: String!,
  	    $password: String!,
  	    $phone_number: String!,
  	    $profile_image_r2: String!,
  	    $profile_image_url: String!,
  	    $summary: String!,
  	    $verification_attempts: Int,
  	    $verification_code: String!,
  	    $verification_code_expires: timestamptz,
  	    $country_code:String!) { 
        insert_users_one(object: {
          id: $id, 
    email: $email, 
    first_name: $first_name,
  	last_name: $last_name,	
    is_email_verified: $is_email_verified,
  	last_seen:$last_seen,
  	last_verification_request:$last_verification,
  	location: $location,
  	password: $password
  	phone_number:$phone_number,
  	profile_image_r2_key:$profile_image_r2,
  	profile_image_url: $profile_image_url,
  	summary:$summary,
  	verification_attempts:$verification_attempts,
  	verification_code:$verification_code,
  	verification_code_expires_at:$verification_code_expires,
  	country_code:$country_code}) {
    id
  }
      }",
      "variables": {
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "email": "test@test.com",
  "first_name": "Diego",
  "last_name": "Smith",
  "is_email_verified": false,
  "last_seen": "2023-01-01T00:00:00Z",
  "last_verification": "2023-01-01T00:00:00Z",
  "location": "New York, USA",
  "password": "securepassword123",
  "phone_number": "87654321",
  "profile_image_r2": "profile_images/r2/key123",
  "profile_image_url": "https://example.com/profile.jpg",
  "summary": "Software developer with 5 years of experience",
  "verification_attempts": 0,
  "verification_code": "123456",
  "verification_code_expires": "2023-01-02T00:00:00Z",
  "country_code": "+506"
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
