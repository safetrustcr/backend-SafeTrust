CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Clear existing seed data (development only)
TRUNCATE users RESTART IDENTITY CASCADE;

-- Users seed data
INSERT INTO users (id, email, last_seen)
VALUES
    (uuid_generate_v4(), 'maria.rodriguez@example.com', '2024-12-10T19:30:00Z'),
    (uuid_generate_v4(), 'carlos.jimenez@example.com', '2024-12-10T18:30:00Z'),
    (uuid_generate_v4(), 'ana.castro@example.com', '2024-12-09T15:30:00Z'),
    (uuid_generate_v4(), 'roberto.mora@example.com', '2024-12-08T14:30:00Z'),
    (uuid_generate_v4(), 'laura.vargas@example.com', '2024-12-07T13:30:00Z'),
    (uuid_generate_v4(), 'pedro.solano@example.com', '2024-12-06T12:30:00Z'),
    (uuid_generate_v4(), 'sofia.mendez@example.com', '2024-12-05T11:30:00Z'),
    (uuid_generate_v4(), 'diego.campos@example.com', '2024-12-04T10:30:00Z'),
    (uuid_generate_v4(), 'carmen.rojas@example.com', '2024-12-03T09:30:00Z'),
    (uuid_generate_v4(), 'miguel.herrera@example.com', '2024-12-02T08:30:00Z'),
    (uuid_generate_v4(), 'julia.martinez@example.com', '2024-12-01T07:30:00Z'),
    (uuid_generate_v4(), 'thomas.mueller@example.com', '2024-11-30T06:30:00Z'),
    (uuid_generate_v4(), 'sarah.johnson@example.com', '2024-11-29T05:30:00Z'),
    (uuid_generate_v4(), 'lucas.silva@example.com', '2024-11-28T04:30:00Z'),
    (uuid_generate_v4(), 'emma.brown@example.com', '2024-11-27T03:30:00Z'),
    (uuid_generate_v4(), 'antoine.dupont@example.com', '2024-11-26T02:30:00Z'),
    (uuid_generate_v4(), 'sofia.garcia@example.com', '2024-11-25T01:30:00Z'),
    (uuid_generate_v4(), 'marco.rossi@example.com', '2024-11-24T00:30:00Z'),
    (uuid_generate_v4(), 'anna.kowalski@example.com', '2024-11-23T23:30:00Z'),
    (uuid_generate_v4(), 'james.wilson@example.com', '2024-11-22T22:30:00Z'),
    (uuid_generate_v4(), 'hans.schmidt@example.com', '2024-11-21T21:30:00Z'),
    (uuid_generate_v4(), 'marie.dubois@example.com', '2024-11-20T20:30:00Z'),
    (uuid_generate_v4(), 'alessandro.conti@example.com', '2024-11-19T19:30:00Z'),
    (uuid_generate_v4(), 'isabel.santos@example.com', '2024-11-18T18:30:00Z'),
    (uuid_generate_v4(), 'john.smith@example.com', '2024-11-17T17:30:00Z');