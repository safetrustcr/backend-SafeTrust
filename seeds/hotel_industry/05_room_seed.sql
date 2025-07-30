-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- Seed data for room_types
INSERT INTO room_types (type_id, name) VALUES
    (uuid_generate_v4(), 'Deluxe'),
    (uuid_generate_v4(), 'Standard'),
    (uuid_generate_v4(), 'Suite'),
    (uuid_generate_v4(), 'Single'),
    (uuid_generate_v4(), 'Double'),
    (uuid_generate_v4(), 'Family');
