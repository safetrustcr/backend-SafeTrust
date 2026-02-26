CREATE TABLE public.escrow_api_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    escrow_transaction_id uuid NOT NULL,
    endpoint text NOT NULL,
    method text NOT NULL,
    request_body jsonb,
    http_status_code integer,
    response_body jsonb,
    error_details jsonb,
    created_at timestamptz DEFAULT now() NOT NULL
);
