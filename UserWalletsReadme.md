# **Hotel Industry User Wallet Migration Guide**  

## **🚀 Running & Testing Users Wallet Migration**  

This guide walks you through applying and verifying the **users_wallets** migration in your local Hasura and PostgreSQL setup using Docker.  

---

## **1️⃣ Prerequisites**  

- Docker & Docker Compose installed  
- Running Hasura & PostgreSQL containers  
- Hasura CLI installed  
- Hasura admin secret available  

---

## **2️⃣ Creating the Required Users Table**  

Before applying the `users_wallets` migration, ensure the `users` table exists in PostgreSQL. If it does not, manually create it inside the container:  

### **2.1 Access the PostgreSQL Container**  
```bash
docker exec -it backend-safetrust-postgres-1 psql -U postgres -d postgres
```

---

### **2.2 Run the Following SQL Inside the PostgreSQL Shell**  
```sql
-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(150) NOT NULL UNIQUE,
    first_name VARCHAR(20),
    last_name VARCHAR(20),
    phone_number VARCHAR(15),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
```

Exit the PostgreSQL shell by typing:  
```bash
\q
```

---

## **3️⃣ Applying Users Wallet Migration**  

### **3.1 Copy Migration Files into the PostgreSQL Container**  
Run the following command to copy the migration SQL into the PostgreSQL container:  

```bash
# Copy users_wallets migration SQL
docker cp migrations/default/1743029389869_create_users_wallets_table/up.sql backend-safetrust-postgres-1:/docker-entrypoint-initdb.d/users_wallets_migration.sql
```

---

### **3.2 Apply the Migration in PostgreSQL**  
```bash
docker exec -it backend-safetrust-postgres-1 psql -U postgres -d postgres -f /docker-entrypoint-initdb.d/users_wallets_migration.sql
```

---

## **4️⃣ Seeding Test Data**  

### **4.1 Copy Seeder File into the PostgreSQL Container**  
```bash
docker cp test_seed/users_seed.sql backend-safetrust-postgres-1:/seed.sql
```

---

### **4.2 Execute Seeder in PostgreSQL**  
```bash
docker exec -it backend-safetrust-postgres-1 psql -U postgres -d postgres -f /seed.sql
```
---

## **5️⃣ Hasura Metadata & Schema Sync**  

### **5.1 Reload Hasura Metadata**  
```bash
curl -X POST http://localhost:8082/v1/metadata \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Admin-Secret: your_admin_secret" \
  -d '{"type": "reload_metadata", "args": {}}'
```

---

## **6️⃣ Verification Steps**  

### **6.1 Check if the Users Wallets Table Exists**  
```bash
docker exec -it backend-safetrust-postgres-1 psql -U postgres -d postgres -c "\dt"
```

Expected Output (Should include `users_wallets`):  
```
         List of relations
 Schema |     Name      | Type  | Owner
--------+--------------+-------+--------
 public | users        | table | postgres
 public | users_wallets | table | postgres

```

---

### **6.2 Verify Inserted Wallet Data**  
```bash
docker exec -it backend-safetrust-postgres-1 psql -U postgres -d postgres -c "SELECT * FROM users_wallets;"
```

Expected Output Example:  
```
                  id                  |               user_id               |         wallet_address         |    chain_type    | is_primary | created_at | updated_at
--------------------------------------+--------------------------------------+--------------------------------+------------------+------------+------------+------------
 e8d62c76-...                         | a12b34cd-...                        | 0x1234567890123456789012345678 | ethereum         | t          | ...
```