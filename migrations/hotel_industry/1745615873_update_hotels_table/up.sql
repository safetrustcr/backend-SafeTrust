-- Update the hotels table to meet requirements

-- Make location_area NOT NULL
ALTER TABLE hotels 
ALTER COLUMN location_area SET NOT NULL;

-- Make timestamps NOT NULL
ALTER TABLE hotels 
ALTER COLUMN created_at SET NOT NULL,
ALTER COLUMN updated_at SET NOT NULL;

-- Change default function from uuid_generate_v4() to gen_random_uuid()
ALTER TABLE hotels
ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Create or replace the update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger on the hotels table
CREATE TRIGGER update_updated_at
BEFORE UPDATE ON hotels
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Set permissions
GRANT SELECT ON hotels TO anonymous;
GRANT SELECT ON hotels TO "user";
GRANT ALL ON hotels TO admin; 