CREATE TABLE hotel_industry.hotel_members (
    hotel_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hotel_members_pkey PRIMARY KEY (hotel_id, user_id),
    CONSTRAINT hotel_members_hotel_id_fkey
        FOREIGN KEY (hotel_id)
        REFERENCES hotel_industry.hotels(id)
        ON DELETE CASCADE,
    CONSTRAINT hotel_members_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES hotel_industry.users(id)
        ON DELETE CASCADE,
    CONSTRAINT hotel_members_role_check
        CHECK (role IN ('OWNER', 'MANAGER', 'STAFF'))
);

CREATE INDEX idx_hotel_members_user_id
    ON hotel_industry.hotel_members(user_id);

CREATE UNIQUE INDEX idx_hotel_members_one_owner_per_hotel
    ON hotel_industry.hotel_members(hotel_id)
    WHERE role = 'OWNER';
