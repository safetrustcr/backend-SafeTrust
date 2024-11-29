-- Drop triggers
DROP TRIGGER IF EXISTS check_tenant_active_bids ON bid_requests;
DROP TRIGGER IF EXISTS record_bid_status ON bid_requests;
DROP TRIGGER IF EXISTS update_bid_requests_updated_at ON bid_requests;

-- Drop functions
DROP FUNCTION IF EXISTS check_active_bids();
DROP FUNCTION IF EXISTS record_bid_status_change();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop indexes
DROP INDEX IF EXISTS idx_bid_requests_apartment;
DROP INDEX IF EXISTS idx_bid_requests_tenant;
DROP INDEX IF EXISTS idx_bid_requests_status;
DROP INDEX IF EXISTS idx_bid_requests_dates;
DROP INDEX IF EXISTS idx_bid_histories_request;
DROP INDEX IF EXISTS idx_bid_histories_dates;

-- Drop tables
DROP TABLE IF EXISTS bid_status_histories;
DROP TABLE IF EXISTS bid_requests;
