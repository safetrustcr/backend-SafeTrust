CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hotel_industry.reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reservation_id UUID,
    wallet_address VARCHAR(255),
    room_id UUID REFERENCES hotel_industry.rooms(room_id),
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    capacity INTEGER,
    reservation_status VARCHAR(15) DEFAULT 'PENDING',
    total_amount NUMERIC(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_reservation_wallet
    ON hotel_industry.reservations(wallet_address);
CREATE INDEX IF NOT EXISTS idx_hotel_reservation_room_id
    ON hotel_industry.reservations(room_id);
CREATE INDEX IF NOT EXISTS idx_hotel_reservation_status
    ON hotel_industry.reservations(reservation_status);
CREATE INDEX IF NOT EXISTS idx_hotel_reservation_dates
    ON hotel_industry.reservations(check_in, check_out);