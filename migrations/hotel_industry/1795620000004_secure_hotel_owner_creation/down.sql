DROP TRIGGER IF EXISTS hotels_create_owner_membership
    ON hotel_industry.hotels;

DROP FUNCTION IF EXISTS hotel_industry.create_hotel_owner_membership();

ALTER TABLE hotel_industry.hotels
    DROP COLUMN IF EXISTS created_by_user_id;
