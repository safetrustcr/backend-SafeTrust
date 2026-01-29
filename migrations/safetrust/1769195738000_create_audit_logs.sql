-- Create audit_logs table for webhook security logging
-- This table stores all incoming webhook requests for security auditing and monitoring

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id VARCHAR(255) NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  method VARCHAR(10) NOT NULL,
  ip_address VARCHAR(45),                     -- IPv4 or IPv6
  user_id UUID,                               -- Reference to user if authenticated
  user_role VARCHAR(100),                     -- Role from JWT/session
  request_body JSONB,                         -- Sanitized request body
  response_status INTEGER,                    -- HTTP status code
  response_body TEXT,                         -- Truncated response (max 1000 chars)
  duration_ms INTEGER,                        -- Request duration in milliseconds
  headers JSONB,                              -- Selected request headers
  error_message TEXT,                         -- Error details if request failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'safetrust',

  -- Constraints
  CONSTRAINT valid_http_method CHECK (method IN (
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'
  )),
  CONSTRAINT valid_status_code CHECK (
    response_status IS NULL OR (response_status >= 100 AND response_status < 600)
  )
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON public.audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_endpoint ON public.audit_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON public.audit_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON public.audit_logs(response_status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON public.audit_logs(tenant_id);

-- Create composite index for time-based queries with filters
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON public.audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON public.audit_logs(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON TABLE public.audit_logs IS 'Security audit log for all webhook requests';
COMMENT ON COLUMN public.audit_logs.request_id IS 'Unique identifier for request tracking';
COMMENT ON COLUMN public.audit_logs.endpoint IS 'API endpoint path that was accessed';
COMMENT ON COLUMN public.audit_logs.method IS 'HTTP method used';
COMMENT ON COLUMN public.audit_logs.ip_address IS 'Client IP address (IPv4 or IPv6)';
COMMENT ON COLUMN public.audit_logs.user_id IS 'Authenticated user ID if available';
COMMENT ON COLUMN public.audit_logs.user_role IS 'User role from JWT or session variables';
COMMENT ON COLUMN public.audit_logs.request_body IS 'Sanitized request payload (sensitive data redacted)';
COMMENT ON COLUMN public.audit_logs.response_status IS 'HTTP response status code';
COMMENT ON COLUMN public.audit_logs.duration_ms IS 'Request processing time in milliseconds';
COMMENT ON COLUMN public.audit_logs.headers IS 'Selected request headers for debugging';

-- Grant appropriate permissions (adjust based on your security model)
-- GRANT SELECT, INSERT ON public.audit_logs TO webhook_service;
-- GRANT SELECT ON public.audit_logs TO audit_viewer;
