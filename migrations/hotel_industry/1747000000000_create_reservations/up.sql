-- Create extension for UUID generation if not already present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reservation_id UUID,
    wallet_address VARCHAR(255),
    room_id UUID REFERENCES rooms(room_id),
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    capacity INTEGER,
    reservation_status VARCHAR(15) DEFAULT 'PENDING',
    total_amount NUMERIC(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_id ON reservations(wallet_address);
CREATE INDEX idx_room_reservation_id ON reservations(room_id);
CREATE INDEX idx_reservation_status ON reservations(reservation_status);
CREATE INDEX idx_reservation_dates ON reservations(check_in, check_out);
