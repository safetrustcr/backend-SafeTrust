-- Create room_types table
CREATE TABLE public.room_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type_id UUID,
    name VARCHAR(25) NOT NULL
);

-- Create index on type_id
CREATE INDEX idx_type_id ON public.room_types(type_id);

-- Grant permissions
GRANT SELECT ON public.room_types TO authenticated;
GRANT SELECT ON public.room_types TO service_role;
GRANT ALL ON public.room_types TO admin;

-- Add RLS policies
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;

-- Policy for users to read room types
CREATE POLICY "Users can read room types"
    ON public.room_types
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy for admins to manage room types
CREATE POLICY "Admins can manage room types"
    ON public.room_types
    TO admin
    USING (true)
    WITH CHECK (true); 