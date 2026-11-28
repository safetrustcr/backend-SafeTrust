CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- security-reviewed: uuid-ossp needed for gen_random_uuid() defaults used by tenant schema
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public; -- security-reviewed: postgis needed for apartment geolocation queries (find-nearby)
