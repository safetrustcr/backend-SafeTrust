ALTER TABLE hotel_industry.users
    ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'GUEST';

UPDATE hotel_industry.users AS u
SET role = CASE
    WHEN EXISTS (
        SELECT 1
        FROM hotel_industry.hotel_members AS hm
        WHERE hm.user_id = u.id
          AND hm.role IN ('OWNER', 'MANAGER')
    ) THEN 'MANAGER'
    WHEN EXISTS (
        SELECT 1
        FROM hotel_industry.hotel_members AS hm
        WHERE hm.user_id = u.id
          AND hm.role = 'STAFF'
    ) THEN 'STAFF'
    ELSE 'GUEST'
END;

ALTER TABLE hotel_industry.users
    ADD CONSTRAINT hotel_valid_user_role
        CHECK (role IN ('GUEST', 'STAFF', 'MANAGER'));

CREATE INDEX idx_hotel_users_role
    ON hotel_industry.users(role);
