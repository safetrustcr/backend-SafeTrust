CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO users (
    id,
    email,
    last_seen,
    first_name,
    last_name,
    summary,
    phone_number,
    country_code,
    location,
    profile_image_url,
    profile_image_r2_key,
    verification_code,
    verification_code_expires_at,
    is_email_verified,
    verification_attempts,
    last_verification_request
) VALUES 
(  
    uuid_generate_v4(),
    'john.doe@example.com',
    '2024-12-10T19:30:00Z',
    'John',
    'Doe',
    'Software developer with 5 years of experience',
    '12345678',
    '+506',
    'New York, USA',
    'test.jpg',
    'profiles/john-doe-123.jpg',
    '123456',
    '2024-12-10T20:30:00Z',
    true,
    0,
    '2024-12-10T19:30:00Z'
);
