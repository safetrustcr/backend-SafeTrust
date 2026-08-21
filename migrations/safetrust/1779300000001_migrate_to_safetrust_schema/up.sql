-- Step 1: Create the safetrust schema
CREATE SCHEMA IF NOT EXISTS safetrust;

-- Step 2: Move all tables (preserves data, indexes, sequences)
ALTER TABLE public.users SET SCHEMA safetrust;
ALTER TABLE public.user_wallets SET SCHEMA safetrust;
ALTER TABLE public.roles SET SCHEMA safetrust;
ALTER TABLE public.user_roles SET SCHEMA safetrust;
ALTER TABLE public.trustless_work_escrows SET SCHEMA safetrust;
ALTER TABLE public.trustless_work_webhook_events SET SCHEMA safetrust;
ALTER TABLE public.escrow_milestones SET SCHEMA safetrust;
ALTER TABLE public.escrow_transactions SET SCHEMA safetrust;
ALTER TABLE public.apartments SET SCHEMA safetrust;
ALTER TABLE public.apartment_images SET SCHEMA safetrust;
ALTER TABLE public.reservations SET SCHEMA safetrust;
ALTER TABLE public.bid_requests SET SCHEMA safetrust;
ALTER TABLE public.pricing_rules SET SCHEMA safetrust;
ALTER TABLE public.pricing_overrides SET SCHEMA safetrust;
ALTER TABLE public.conversations SET SCHEMA safetrust;
ALTER TABLE public.messages SET SCHEMA safetrust;

-- Step 3: Add safetrust to search_path so existing queries still work
-- during transition period (remove after all queries are updated)
ALTER DATABASE postgres SET search_path TO safetrust, public;

-- Step 4: Grant schema permissions to hasura role
GRANT USAGE ON SCHEMA safetrust TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA safetrust TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA safetrust TO postgres;

-- Step 5: Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA safetrust GRANT ALL ON SEQUENCES TO postgres;
