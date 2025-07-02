CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
-- Create room_types table
CREATE TABLE room_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type_id UUID,
    name VARCHAR(25) NOT NULL
);

-- Create index on type_id
CREATE INDEX idx_type_id ON room_types(type_id);

-- Grant permissions
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE admin;

GRANT SELECT ON public.room_types TO authenticated;
GRANT SELECT ON public.room_types TO service_role;
GRANT ALL ON public.room_types TO admin;