INSERT INTO hotels (id, name, description, address, location_area, coordinates)
VALUES
  (
    uuid_generate_v4(),
    'Grand Hotel',
    'Luxury hotel in the city',
    '123 Main St',
    'Downtown',
    ST_SetSRID(ST_MakePoint(-84.0833, 9.9333), 4326)
  ),
  (
    uuid_generate_v4(),
    'Cozy Inn',
    'Small and comfortable',
    '456 Elm St',
    'Suburb',
    ST_SetSRID(ST_MakePoint(-84.1, 9.935), 4326)
  );
