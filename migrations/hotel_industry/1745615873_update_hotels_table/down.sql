-- Revert changes to the hotels table

-- Drop the trigger
DROP TRIGGER IF EXISTS update_updated_at ON hotels;

-- Revert ID default to uuid_generate_v4()
ALTER TABLE hotels
ALTER COLUMN id SET DEFAULT uuid_generate_v4();

-- Revert location_area to allow NULL
ALTER TABLE hotels 
ALTER COLUMN location_area DROP NOT NULL;

-- Revert timestamps to allow NULL
ALTER TABLE hotels 
ALTER COLUMN created_at DROP NOT NULL,
ALTER COLUMN updated_at DROP NOT NULL;

-- Revoke permissions
REVOKE SELECT ON hotels FROM anonymous;
REVOKE SELECT ON hotels FROM "user";
REVOKE ALL ON hotels FROM admin; 