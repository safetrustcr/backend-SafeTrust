Feature: Hotel catalog cascade behavior

Background:
  * def UUID = Java.type('java.util.UUID')
  * def hotelId = UUID.randomUUID().toString()
  * def roomTypeId = UUID.randomUUID().toString()
  * def reservationId = UUID.randomUUID().toString()
  * def longImageUrl = 'https://storage.example/' + 'a'.repeat(200)
  * db.execute("INSERT INTO hotel_industry.hotels (id, name, address_line) VALUES ('" + hotelId + "', 'Cascade test', 'Test address')")
  * db.execute("INSERT INTO hotel_industry.room_types (id, name) VALUES ('" + roomTypeId + "', 'Cascade test type')")
  * db.execute("INSERT INTO hotel_industry.rooms (hotel_id, room_number, room_type_id, price_night, capacity) VALUES ('" + hotelId + "', '901', '" + roomTypeId + "', 100, 2)")
  * def room = db.query("SELECT id FROM hotel_industry.rooms WHERE hotel_id = '" + hotelId + "'")
  * def roomId = room[0].id
  * def roomAvailability = db.query("SELECT is_active FROM hotel_industry.rooms WHERE id = '" + roomId + "'")
  * match roomAvailability[0].is_active == '#? _ == "true" || _ == "t" || _ == true'
  * db.execute("DO $$ BEGIN INSERT INTO hotel_industry.rooms (hotel_id, room_number, room_type_id, price_night, capacity) VALUES ('" + hotelId + "', '902', '" + roomTypeId + "', 100, 0); RAISE EXCEPTION 'capacity check did not reject zero'; EXCEPTION WHEN check_violation THEN NULL; END $$")
  * db.execute("INSERT INTO hotel_industry.room_images (room_id, image_url) VALUES ('" + roomId + "', '" + longImageUrl + "')")
  * db.execute("INSERT INTO hotel_industry.hotel_images (hotel_id, image_url) VALUES ('" + hotelId + "', '" + longImageUrl + "')")
  * db.execute("INSERT INTO hotel_industry.reservations (id, room_id, total_amount) VALUES ('" + reservationId + "', '" + roomId + "', 9000000)")
  * db.execute("INSERT INTO hotel_industry.pricing_rules (hotel_id, room_type_id, rule_name, rule_type, currency) VALUES ('" + hotelId + "', '" + roomTypeId + "', 'Cascade test rule', 'TEST', 'USD')")

Scenario: Deleting a hotel cascades its catalog while preserving reservations
  * db.execute("UPDATE hotel_industry.rooms SET is_active = false WHERE id = '" + roomId + "'")
  * def reservationBeforeDelete = db.query("SELECT room_id FROM hotel_industry.reservations WHERE id = '" + reservationId + "'")
  * match reservationBeforeDelete[0].room_id == roomId
  * def topRooms = db.query("SELECT id FROM hotel_industry.get_top_rooms_by_reservations('all', NULL)")
  * match topRooms[*].id contains roomId

  # One hotel deletion must cascade through its catalog and detach, not delete, reservations.
  * db.execute("DELETE FROM hotel_industry.hotels WHERE id = '" + hotelId + "'")

  * def roomsLeft = db.query("SELECT COUNT(*) AS count FROM hotel_industry.rooms WHERE hotel_id = '" + hotelId + "'")
  * def roomImagesLeft = db.query("SELECT COUNT(*) AS count FROM hotel_industry.room_images WHERE room_id = '" + roomId + "'")
  * def hotelImagesLeft = db.query("SELECT COUNT(*) AS count FROM hotel_industry.hotel_images WHERE hotel_id = '" + hotelId + "'")
  * def pricingRulesLeft = db.query("SELECT COUNT(*) AS count FROM hotel_industry.pricing_rules WHERE hotel_id = '" + hotelId + "'")
  * def reservationAfterDelete = db.query("SELECT room_id FROM hotel_industry.reservations WHERE id = '" + reservationId + "'")
  * match roomsLeft[0].count == '0'
  * match roomImagesLeft[0].count == '0'
  * match hotelImagesLeft[0].count == '0'
  * match pricingRulesLeft[0].count == '0'
  * match reservationAfterDelete[0].room_id == null

  * db.execute("DELETE FROM hotel_industry.reservations WHERE id = '" + reservationId + "'")
  * db.execute("DELETE FROM hotel_industry.room_types WHERE id = '" + roomTypeId + "'")
