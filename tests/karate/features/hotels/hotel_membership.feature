Feature: Hotel membership access control

Background:
  * url baseUrl
  * def UUID = Java.type('java.util.UUID')
  * def ownerId = UUID.randomUUID().toString()
  * def otherUserId = UUID.randomUUID().toString()
  * def hotelName = 'Hotel Boutique Monteverde'
  * db.execute("INSERT INTO hotel_industry.users (id, email) VALUES ('" + ownerId + "', '" + ownerId + "@example.test')")
  * db.execute("INSERT INTO hotel_industry.users (id, email) VALUES ('" + otherUserId + "', '" + otherUserId + "@example.test')")
  * header x-hasura-role = 'user'
  * header x-hasura-user-id = ownerId

Scenario: Creator becomes owner and another user cannot update the hotel
  * def createQuery = 'mutation CreateHotel($object: hotel_industry_hotels_insert_input!) { insert_hotel_industry_hotels_one(object: $object) { id name members { user_id role } } }'
  * def createVariables = { object: { name: '#(hotelName)', address_line: 'Avenida Central 100', city: 'San José' } }
  Given request { query: '#(createQuery)', variables: '#(createVariables)' }
  When method POST
  Then status 200
  And match response.errors == '#notpresent'
  And match response.data.insert_hotel_industry_hotels_one.name == hotelName
  And match response.data.insert_hotel_industry_hotels_one.members == [{ user_id: '#(ownerId)', role: 'OWNER' }]
  * def hotelId = response.data.insert_hotel_industry_hotels_one.id

  * header x-hasura-user-id = otherUserId
  * def updateQuery = 'mutation UpdateHotel($id: uuid!) { update_hotel_industry_hotels_by_pk(pk_columns: {id: $id}, _set: {name: "Unauthorized update"}) { id } }'
  Given request { query: '#(updateQuery)', variables: { id: '#(hotelId)' } }
  When method POST
  Then status 200
  And match response.errors == '#notpresent'
  And match response.data.update_hotel_industry_hotels_by_pk == null
  * def unchangedHotel = db.query("SELECT name FROM hotel_industry.hotels WHERE id = '" + hotelId + "'")
  And match unchangedHotel[0].name == hotelName

  * def ownerlessHotelId = UUID.randomUUID().toString()
  * db.execute("INSERT INTO hotel_industry.hotels (id, name, address_line) VALUES ('" + ownerlessHotelId + "', 'Legacy hotel', 'Test address')")
  * def claimQuery = 'mutation ClaimOwner($object: hotel_industry_hotel_members_insert_input!) { insert_hotel_industry_hotel_members_one(object: $object) { hotel_id user_id role } }'
  * def claimVariables = { object: { hotel_id: '#(ownerlessHotelId)', user_id: '#(otherUserId)', role: 'OWNER' } }
  Given request { query: '#(claimQuery)', variables: '#(claimVariables)' }
  When method POST
  Then status 200
  And match response.errors == '#present'
  * def claimedMembership = db.query("SELECT user_id FROM hotel_industry.hotel_members WHERE hotel_id = '" + ownerlessHotelId + "'")
  And match claimedMembership == []

  * db.execute("DELETE FROM hotel_industry.hotels WHERE id = '" + ownerlessHotelId + "'")
  * db.execute("DELETE FROM hotel_industry.hotels WHERE id = '" + hotelId + "'")
  * db.execute("DELETE FROM hotel_industry.users WHERE id IN ('" + ownerId + "', '" + otherUserId + "')")
