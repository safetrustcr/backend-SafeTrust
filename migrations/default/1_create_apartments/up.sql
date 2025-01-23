CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE apartments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert a test apartment
INSERT INTO apartments (id, name, description) VALUES 
('11111111-1111-1111-1111-111111111111', 'Modern Loft in Heredia', 'A beautiful modern loft'); 