CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
-- Create room_types table
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE room_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(25) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(name)
);

-- Index for performance (especially if you'll search by name)
CREATE INDEX idx_room_types_name ON room_types(name);
-- Create index on type_id
CREATE INDEX idx_type_id ON room_types(id);

-- Grant permissions
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE admin;

GRANT SELECT ON public.room_types TO authenticated;
GRANT SELECT ON public.room_types TO service_role;
GRANT ALL ON public.room_types TO admin;