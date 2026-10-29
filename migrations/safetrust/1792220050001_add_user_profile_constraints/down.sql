ALTER TABLE safetrust.users
  DROP CONSTRAINT IF EXISTS users_first_name_length,
  DROP CONSTRAINT IF EXISTS users_last_name_length,
  DROP CONSTRAINT IF EXISTS users_phone_number_length,
  DROP CONSTRAINT IF EXISTS users_country_code_format,
  DROP CONSTRAINT IF EXISTS users_location_length;
