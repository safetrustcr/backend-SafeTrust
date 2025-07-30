-- Insert sample users
INSERT INTO users (email, first_name, last_name, phone_number)
VALUES
  ('alice.renter@example.com', 'Alice', 'Renter', '111-111-1111'),
  ('bob.owner@example.com', 'Bob', 'Owner', '222-222-2222'),
  ('charlie.witness@example.com', 'Charlie', 'Witness', '333-333-3333'),
  ('diana.renter@example.com', 'Diana', 'Renter', '444-444-4444')
ON CONFLICT (email) DO NOTHING;
