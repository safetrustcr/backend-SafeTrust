-- Migration: Create webhook audit logs table
-- Description: Stores audit logs for all webhook requests for security and compliance

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create webhook_audit_logs table
CREATE TABLE IF NOT EXISTS webhook_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    ip VARCHAR(45) NOT NULL, -- IPv6 compatible
    user_id UUID,
    tenant_id VARCHAR(100),
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    request_body JSONB,
    response_body JSONB,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_audit_timestamp ON webhook_audit_logs(timestamp DESC);
CREATE INDEX idx_audit_user_id ON webhook_audit_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_tenant_id ON webhook_audit_logs(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_audit_endpoint ON webhook_audit_logs(endpoint);
CREATE INDEX idx_audit_failed ON webhook_audit_logs(success) WHERE success = FALSE;
CREATE INDEX idx_audit_ip ON webhook_audit_logs(ip);

-- Add comments for documentation
COMMENT ON TABLE webhook_audit_logs IS 'Audit trail for all webhook requests';
COMMENT ON COLUMN webhook_audit_logs.endpoint IS 'Request endpoint path';
COMMENT ON COLUMN webhook_audit_logs.method IS 'HTTP method (GET, POST, etc.)';
COMMENT ON COLUMN webhook_audit_logs.ip IS 'Client IP address';
COMMENT ON COLUMN webhook_audit_logs.user_id IS 'Hasura user ID from session variables';
COMMENT ON COLUMN webhook_audit_logs.tenant_id IS 'Tenant/organization ID from session variables';
COMMENT ON COLUMN webhook_audit_logs.status_code IS 'HTTP response status code';
COMMENT ON COLUMN webhook_audit_logs.duration_ms IS 'Request processing duration in milliseconds';
COMMENT ON COLUMN webhook_audit_logs.success IS 'Whether request was successful (status < 400)';
COMMENT ON COLUMN webhook_audit_logs.request_body IS 'Sanitized request body (sensitive data redacted)';
COMMENT ON COLUMN webhook_audit_logs.response_body IS 'Sanitized response body (sensitive data redacted)';
COMMENT ON COLUMN webhook_audit_logs.user_agent IS 'Client user agent string';
COMMENT ON COLUMN webhook_audit_logs.timestamp IS 'When the request was received';

-- Create function to clean up old audit logs (keep 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM webhook_audit_logs
    WHERE timestamp < NOW() - INTERVAL '90 days';
    
    RAISE NOTICE 'Cleaned up audit logs older than 90 days';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_audit_logs() IS 'Deletes audit logs older than 90 days for data retention compliance';

