-- Drop triggers first
DROP TRIGGER IF EXISTS check_tenant_active_bids ON bid_requests;
DROP TRIGGER IF EXISTS record_bid_status ON bid_requests;
DROP TRIGGER IF EXISTS update_bid_requests_updated_at ON bid_requests;

-- Drop indexes
DROP INDEX IF EXISTS idx_bid_requests_apartment;
DROP INDEX IF EXISTS idx_bid_requests_tenant;
DROP INDEX IF EXISTS idx_bid_requests_status;
DROP INDEX IF EXISTS idx_bid_requests_dates;
DROP INDEX IF EXISTS idx_bid_histories_request;
DROP INDEX IF EXISTS idx_bid_histories_dates;

-- Drop tables with CASCADE to ensure all dependencies are removed
DROP TABLE IF EXISTS bid_status_histories CASCADE;
DROP TABLE IF EXISTS bid_requests CASCADE;

-- Drop functions last
DROP FUNCTION IF EXISTS check_active_bids() CASCADE;
DROP FUNCTION IF EXISTS record_bid_status_change() CASCADE;