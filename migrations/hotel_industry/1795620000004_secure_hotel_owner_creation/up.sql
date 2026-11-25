ALTER TABLE hotel_industry.hotels
    ADD COLUMN created_by_user_id UUID
        REFERENCES hotel_industry.users(id)
        ON DELETE SET NULL;

CREATE FUNCTION hotel_industry.create_hotel_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = hotel_industry, pg_temp
AS $$
BEGIN
    IF NEW.created_by_user_id IS NOT NULL THEN
        INSERT INTO hotel_industry.hotel_members (hotel_id, user_id, role)
        VALUES (NEW.id, NEW.created_by_user_id, 'OWNER');
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hotels_create_owner_membership
AFTER INSERT ON hotel_industry.hotels
FOR EACH ROW
EXECUTE FUNCTION hotel_industry.create_hotel_owner_membership();
