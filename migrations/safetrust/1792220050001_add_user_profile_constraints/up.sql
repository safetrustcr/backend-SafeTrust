ALTER TABLE safetrust.users
  ADD CONSTRAINT users_first_name_length
    CHECK (first_name IS NULL OR char_length(btrim(first_name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT users_last_name_length
    CHECK (last_name IS NULL OR char_length(btrim(last_name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT users_phone_number_length
    CHECK (phone_number IS NULL OR char_length(btrim(phone_number)) BETWEEN 7 AND 32),
  ADD CONSTRAINT users_country_code_format
    CHECK (country_code IS NULL OR country_code ~ '^\+[0-9]{1,4}$'),
  ADD CONSTRAINT users_location_length
    CHECK (location IS NULL OR char_length(btrim(location)) BETWEEN 1 AND 255);
