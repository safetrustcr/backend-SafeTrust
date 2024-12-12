# 🌟 SafeTrust 🌟

**SafeTrust** is a decentralized platform designed to revolutionize P2P transactions, providing secure deposits and payments powered by blockchain and trustless technologies. 🌐✨ Experience transparency and reliability in every cryptocurrency transaction. 💸🔒

---

## 🚀 **Why Choose SafeTrust?**

🔐 **Trustless Technology**: Secure and block deposits without intermediaries.  
💾 **Blockchain-Powered Transparency**: Immutable, auditable, and verifiable transactions.  
💱 **Crypto-Payment Support**: Manage cryptocurrency payments safely and efficiently.  
✅ **Automated Refunds**: Streamlined processes ensure refunds and payment releases happen automatically.

---

## 🌟 **Key Features**

🛠️ **Trustless Escrow**:  
Funds are securely held in blockchain-based escrow accounts until all terms are met.

🔎 **Blockchain Transparency**:  
Every transaction is logged on the blockchain for full visibility and accountability. 📜

💰 **Crypto Payments**:  
Supports irreversible and secure cryptocurrency payments while reducing risks of fraud or disputes.

🔗 **Trustline Process**:  
Verified trustlines between parties add an extra layer of transaction security. 🔒

📤 **Automated Refund System**:  
Ensures funds are automatically released based on the terms of the agreement, with no manual intervention required.

---

## ⚙️ **How It Works**

1. **Create Escrow**: The renter creates a secure escrow account. 🏗️
2. **Fund Escrow**: The deposit is funded by the renter. 💵
3. **Rental Agreement**: Terms are agreed upon and stored on the blockchain. 📃
4. **Completion or Cancellation**: Funds are released based on contract outcomes. 🎯

---

## 📋 **Getting Started**

### **Prerequisites**

0. Install Docker and Docker Compose
1. Download the Hasura global binary. See steps [here](https://hasura.io/docs/2.0/hasura-cli/install-hasura-cli/)
2. Run

```shell

docker compose up -d
```

3. Connect with database. For this run `hasura console` and follow this [guide](https://hasura.io/docs/2.0/databases/quickstart/#on-hasura-deployed-via-docker)

Connect using an environment variable and just type `PG_DATABASE_URL`

Name your database as `safetrust` (instead of default) when prompted to do so.

Now, run the migrations.

```shell
hasura migrate apply --admin-secret myadminsecretkey
```

4. Adding migrations.

You can add migrations either with the hasura console or by the command:

```shell
hasura migrate create [enable_postgis] --admin-secret myadminsecretkey
```

where `enable_postgis` is the name of the migration. Please make sure to use descriptive names with verbs about what the migration is doing!

Then to apply them:

```shell
hasura migrate apply --admin-secret myadminsecretkey
```

If you wanna use the hasura web console and access it on `http://localhost:9695/`:

```shell
hasura console --admin-secret myadminsecretkey
```

And you should be good to go to start and work on this.

## 📋 **Known Issues**

### 📝 **Title**

**Error Running Docker Compose**

### ❌ **Error Message**

> `Rosetta error: Rosetta is only intended to run on Apple Silicon with a macOS host using Virtualization.framework with Rosetta mode enabled`

### 🔍 **Error Description**

1. Run `docker compose up -d`.
2. If the **Backend postgres-1 module** can't start and shows the error above:
   - This is due to an issue with Rosetta settings on Apple Silicon devices.
3. ✅ **Solution:**
   - Go to **Docker Settings** and disable the:  
     `Use Rosetta for x86_64/amd64 emulation on Apple Silicon` selection button.
   - 🔄 Restart Docker.
   - 🚀 It should now run great!

# Backend Tests

This project uses Karate framework for API testing. The tests are designed to run in a Docker environment.

## Prerequisites

- Docker
- Docker Compose

## Project Structure

```
backend/
├── docker-compose-test.yml
├── Dockerfile.test
└── tests/
    ├── karate.jar
    └── karate/
        ├── features/
        │   ├── auth/
        │   │   ├── login.feature
        │   │   └── permissions.feature
        │   └── users/
        │       ├── create.feature
        │       └── query.feature
        └── src/
            └── test/
                └── resources/
                    └── karate-config.js
```

## Running Tests

To run all tests:

```bash
docker compose -f docker-compose-test.yml up --build --abort-on-container-exit
```

This command will:

1. Build the test container
2. Start PostgreSQL and Hasura containers
3. Run all Karate tests
4. Show test results in the console
5. Generate HTML reports in `target/karate-reports/`

## Test Reports

After running the tests, you can find the HTML reports at:

- Summary: `tests/results/karate-summary.html`
- Detailed: `tests/results/karate-tags.html`

## Development

### Adding New Tests

1. Create new `.feature` files in `tests/karate/features/`
2. Follow the Karate DSL syntax
3. Tests will be automatically picked up when running the test command

### Configuration

- Main config: `tests/karate/src/test/resources/karate-config.js`
- Database config: `docker-compose-test.yml`
- Test environment: `Dockerfile.test`

## Troubleshooting

If tests fail with connection errors:

1. Ensure all containers are running: `docker compose -f docker-compose-test.yml ps`
2. Check container logs: `docker compose -f docker-compose-test.yml logs`
3. Verify network connectivity: `docker network inspect backend_test-network`
