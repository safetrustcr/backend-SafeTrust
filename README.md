🌟 SafeTrust 🌟

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
hasura migrate apply
```

4. Adding migrations.

You can add migrations either with the hasura console or by the command:

```shell
hasura migrate create [enable_postgis]
```

where `enable_postgis` is the name of the migration. Please make sure to use descriptive names with verbs about what the migration is doing!

Then to apply them:

```shell
hasura migrate apply
```

If you wanna use the hasura web console and access it on `http://localhost:9695/`:


```shell
hasura console
```

And you should be good to go to start and work on this.