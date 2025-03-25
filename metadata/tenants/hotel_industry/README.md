# Hotel Industry Tenant - Users Table Documentation

## Overview

The users table in the hotel industry tenant stores customer information with specific fields required for the hotel industry use case. This table is part of our multi-tenant architecture and is managed through our metadata deployment system.

## Table Structure

The `users` table contains the following fields:

- `id` (UUID, Primary Key): Automatically generated unique identifier
- `email` (VARCHAR(150)): Unique email address for the user
- `first_name` (VARCHAR(20)): User's first name
- `last_name` (VARCHAR(20)): User's last name
- `phone_number` (VARCHAR(15)): Contact phone number
- `created_at` (TIMESTAMP WITH TIME ZONE): Automatic timestamp of record creation
- `updated_at` (TIMESTAMP WITH TIME ZONE): Automatic timestamp of last update

## Constraints

- Primary Key on `id`
- Unique constraint on `email`
- NOT NULL constraints on `id`, `email`, `created_at`, and `updated_at`

## Indexes

- `users_email_idx`: Index on email field for faster lookups
- `users_created_at_idx`: Index on created_at for efficient temporal queries

## Automatic Updates

- `updated_at` field is automatically updated via trigger when any field is modified
- `id` is automatically generated using UUID v4 when a new record is created

## Usage Examples

### Creating a New User

```sql
INSERT INTO public.users (email, first_name, last_name, phone_number)
VALUES ('user@example.com', 'John', 'Doe', '+1234567890');
```

### Updating User Information

```sql
UPDATE public.users
SET first_name = 'Jane',
    phone_number = '+9876543210'
WHERE email = 'user@example.com';
```

### Querying Users

```sql
-- Get user by email
SELECT * FROM public.users WHERE email = 'user@example.com';

-- Get recently created users
SELECT * FROM public.users
ORDER BY created_at DESC
LIMIT 10;
```

## Deployment

To deploy or update the users table:

1. Build the tenant metadata:

```bash
./build-metadata.sh hotel_industry --admin-secret myadminsecretkey --endpoint "endpoint"
```

2. Deploy the tenant:

```bash
./deploy-tenant.sh hotel_industry --admin-secret myadminsecretkey --endpoint "endpoint"
```

## Testing

Run the test suite to validate table functionality:

```bash
psql -f tests/hotel_industry/test_users_table.sql
```

## Best Practices

1. Always use parameterized queries to prevent SQL injection
2. Validate email format before insertion
3. Use appropriate indexes for your specific query patterns
4. Regularly monitor table size and performance
5. Follow the tenant isolation pattern when querying across tenants
