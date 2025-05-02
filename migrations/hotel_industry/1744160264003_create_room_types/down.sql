-- Drop policies
DROP POLICY IF EXISTS "Users can read room types" ON public.room_types;
DROP POLICY IF EXISTS "Admins can manage room types" ON public.room_types;

-- Revoke permissions
REVOKE ALL ON public.room_types FROM admin;
REVOKE SELECT ON public.room_types FROM service_role;
REVOKE SELECT ON public.room_types FROM authenticated;

-- Drop index
DROP INDEX IF EXISTS idx_type_id;

-- Drop table
DROP TABLE IF EXISTS public.room_types; 