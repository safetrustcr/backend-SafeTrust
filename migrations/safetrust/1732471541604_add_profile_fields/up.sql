ALTER TABLE users 
ADD COLUMN first_name TEXT,
ADD COLUMN last_name TEXT,
ADD COLUMN summary TEXT,
ADD COLUMN phone_number TEXT,
ADD COLUMN country_code TEXT DEFAULT '+506',
ADD COLUMN location TEXT,
ADD COLUMN profile_image_url TEXT,
ADD COLUMN profile_image_r2_key TEXT;

ALTER TABLE users
ADD CONSTRAINT valid_phone_format CHECK (phone_number ~ '^\d{8}$'),
ADD CONSTRAINT valid_country_code CHECK (country_code ~ '^\+\d{1,4}$');
