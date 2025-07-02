-- Drop policies
DROP POLICY IF EXISTS "Users can read room types" ON room_types;
DROP POLICY IF EXISTS "Admins can manage room types" ON room_types;

-- Revoke permissions
REVOKE ALL ON room_types FROM admin;
REVOKE SELECT ON room_types FROM service_role;
REVOKE SELECT ON room_types FROM authenticated;

-- Drop index
DROP INDEX IF EXISTS idx_type_id;

-- Drop table
DROP TABLE IF EXISTS room_types; 