-- Función para actualizar automáticamente updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tabla principal de solicitudes de ofertas
CREATE TABLE bid_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    apartment_id UUID REFERENCES apartments(id) ON DELETE CASCADE,
    tenant_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    current_status TEXT NOT NULL DEFAULT 'PENDING',
    proposed_price DECIMAL(10,2) NOT NULL CHECK (proposed_price > 0),
    desired_move_in TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_status CHECK (
        current_status IN (
            'PENDING',
            'VIEWED',
            'APPROVED',
            'CONFIRMED',
            'ESCROW_FUNDED',
            'ESCROW_COMPLETED',
            'CANCELLED'
        )
    )
);

-- Tabla de historial de estados
CREATE TABLE bid_status_histories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_request_id UUID REFERENCES bid_requests(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    notes TEXT,
    changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Función para registrar cambios de estado
CREATE OR REPLACE FUNCTION record_bid_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (OLD.current_status IS DISTINCT FROM NEW.current_status) THEN
        INSERT INTO bid_status_histories (
            bid_request_id,
            status,
            changed_by
        ) VALUES (
            NEW.id,
            NEW.current_status,
            current_setting('hasura.user', true)::text
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para registrar cambios de estado
CREATE TRIGGER record_bid_status
    AFTER INSERT OR UPDATE ON bid_requests
    FOR EACH ROW
    EXECUTE FUNCTION record_bid_status_change();

-- Índices para optimización
CREATE INDEX idx_bid_requests_apartment 
    ON bid_requests(apartment_id);
CREATE INDEX idx_bid_requests_tenant 
    ON bid_requests(tenant_id);
CREATE INDEX idx_bid_requests_status 
    ON bid_requests(current_status);
CREATE INDEX idx_bid_requests_dates 
    ON bid_requests(created_at, desired_move_in);
CREATE INDEX idx_bid_histories_request 
    ON bid_status_histories(bid_request_id);
CREATE INDEX idx_bid_histories_dates 
    ON bid_status_histories(created_at);

-- Trigger para actualizar updated_at
CREATE TRIGGER update_bid_requests_updated_at
    BEFORE UPDATE ON bid_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Función para verificar ofertas activas
CREATE OR REPLACE FUNCTION check_active_bids()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_status IN ('PENDING', 'VIEWED', 'APPROVED') THEN
        IF EXISTS (
            SELECT 1 FROM bid_requests
            WHERE tenant_id = NEW.tenant_id
            AND id != NEW.id
            AND current_status IN ('PENDING', 'VIEWED', 'APPROVED')
            AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION 'Tenant already has an active bid';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para verificar ofertas activas
CREATE TRIGGER check_tenant_active_bids
    BEFORE INSERT OR UPDATE ON bid_requests
    FOR EACH ROW
    EXECUTE FUNCTION check_active_bids();