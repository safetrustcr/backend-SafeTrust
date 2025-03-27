# Hotel Industry Tenant - Rooms Table Implementation

## Overview
This project implements the `rooms` table for the `hotel_industry` tenant as part of our multi-tenant architecture. The table stores essential room-related information, including room number, type, price, status, and capacity, with a foreign key relationship to the `hotels` table.

## Table Schema
The `rooms` table is structured as follows:

- **room_id** (UUID, Primary Key, Auto-generated)
- **hotel_id** (UUID, Foreign Key referencing `hotels(id)`, `ON DELETE CASCADE` enabled)
- **room_number** (VARCHAR(5), Unique per hotel)
- **room_type** (VARCHAR(50), Describes room category)
- **price_night** (DECIMAL(10,2), Must be greater than 0)
- **status** (BOOLEAN, Defaults to `true` for available rooms)
- **capacity** (INT, Must be greater than 0)
- **created_at** (TIMESTAMP WITH TIME ZONE, Defaults to `NOW()`)
- **updated_at** (TIMESTAMP WITH TIME ZONE, Defaults to `NOW()`)

### Indexes
- `hotel_id` index for optimized hotel-based lookups.
- `room_type` index for filtering by room category.

## Deployment Steps
### 1. Define Table in Hasura Metadata
The table definition is added under `metadata/tenants/hotel_industry/tables/public_rooms.yaml`.

### 2. Run Metadata Deployment
Execute the following command to deploy the metadata:
```sh
./deploy-tenant.sh hotel_industry --admin-secret myadminsecretkey --endpoint "http://localhost:8082"
```

### 3. Seed Data (Optional)
To insert initial room records into the database, copy the seed SQL file into the PostgreSQL container and execute it:
```sh
docker cp metadata/tenants/hotel_industry/test_seed/public_room_seed.sql backend-safetrust-postgres-1:/seed.sql
docker exec -it backend-safetrust-postgres-1 psql -U postgres -d postgres -f /seed.sql
```

### 4. Verify in Hasura Console
1. Go to **Hasura Console** (`http://localhost:8082`)
2. Navigate to **Data** → **rooms** and check if the table exists.
3. Run the following GraphQL query to test:
   ```graphql
   query {
     rooms {
       room_id
       room_number
       price_night
     }
   }
   ```

## Testing
- Ensure the table is created and tracked properly.
- Run test queries in Hasura to validate constraints and relationships.
- Check the foreign key relationship with `hotels`.

## Conclusion
This implementation ensures that each hotel within the `hotel_industry` tenant has properly managed rooms with strict constraints for data consistency and integrity.

