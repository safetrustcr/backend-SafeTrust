-- Global STAFF and MANAGER values have no reliable hotel mapping. They are
-- intentionally not converted into memberships; those users have no hotel
-- membership until an administrator assigns one.
DROP INDEX IF EXISTS hotel_industry.idx_hotel_users_role;

ALTER TABLE hotel_industry.users
    DROP CONSTRAINT IF EXISTS hotel_valid_user_role,
    DROP COLUMN role;
