-- seeds/hotel_industry/01_users_seed.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO hotel_industry.users (id, email, first_name, last_name, phone_number)
VALUES
  (uuid_generate_v4(), 'alice.renter@example.com',    'Alice',   'Renter',  '111-111-1111'),
  (uuid_generate_v4(), 'bob.owner@example.com',       'Bob',     'Owner',   '222-222-2222'),
  (uuid_generate_v4(), 'charlie.witness@example.com', 'Charlie', 'Witness', '333-333-3333'),
  (uuid_generate_v4(), 'diana.renter@example.com',    'Diana',   'Renter',  '444-444-4444')
ON CONFLICT (email) DO NOTHING;