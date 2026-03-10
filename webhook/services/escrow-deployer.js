"use strict";

const axios = require("axios");

const REQUIRED_ENV = ['TRUSTLESS_WORK_API_URL', 'TRUSTLESS_WORK_API_KEY', 'HASURA_ADMIN_SECRET'];
for (const key of REQUIRED_ENV) {
     if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}
const HASURA_URL_RESOLVED = process.env.HASURA_GRAPHQL_URL || process.env.HASURA_URL;
if (!HASURA_URL_RESOLVED) throw new Error("Missing required env var: HASURA_GRAPHQL_URL or HASURA_URL");



const trustlessWork = axios.create({
     baseURL: process.env.TRUSTLESS_WORK_API_URL || "https://dev.api.trustlesswork.com",
     timeout: 15000,
     headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.TRUSTLESS_WORK_API_KEY,
     },
});

const hasura = axios.create({
     baseURL: HASURA_URL_RESOLVED,
     timeout: 10000,
     headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": process.env.HASURA_ADMIN_SECRET,
     },
});

const INSERT_ESCROW = `
  mutation InsertEscrow($object: trustless_work_escrows_insert_input!) {
    insert_trustless_work_escrows_one(object: $object) {
      id
      contract_id
    }
  }
`;

/**
 * Update an existing escrow row (identified by engagementId / contractId).
 * Used to flip status to "pending_signature" on success or "failed" on error.
 */
const UPDATE_ESCROW_STATUS = `
  mutation UpdateEscrowStatus($contractId: String!, $status: String!) {
    update_trustless_work_escrows(
      where: { contract_id: { _eq: $contractId } }
      _set: { status: $status }
    ) {
      returning { id contract_id status }
    }
  }
`;

const INSERT_XDR = `
  mutation InsertXdr($object: escrow_xdr_transactions_insert_input!) {
    insert_escrow_xdr_transactions_one(object: $object) {
      id
    }
  }
`;


const STELLAR_REGEX = /^G[A-Z2-7]{55}$/;

function validate(body) {
     const errors = [];

     // At this point body fields have already been trimmed by createEscrow.
     if (!body.senderAddress) {
          errors.push("senderAddress is required");
     } else if (!STELLAR_REGEX.test(body.senderAddress)) {
          errors.push("senderAddress must be a valid Stellar public key");
     }

     if (!body.receiverAddress) {
          errors.push("receiverAddress is required");
     } else if (!STELLAR_REGEX.test(body.receiverAddress)) {
          errors.push("receiverAddress must be a valid Stellar public key");
     }

     const amount = Number(body.amount);
     if (body.amount === undefined || body.amount === null || body.amount === "") {
          errors.push("amount is required");
     } else if (isNaN(amount) || amount <= 0) {
          errors.push("amount must be a positive number");
     }

     if (!body.propertyId || !String(body.propertyId).trim()) {
          errors.push("propertyId is required");
     }

     return errors;
}

// ─── Hasura helpers ───────────────────────────────────────────────────────────

async function dbInsertEscrow(vars) {
     const { data: gql } = await hasura.post("", {
          query: INSERT_ESCROW,
          variables: {
               object: {
                    contract_id: vars.contractId,
                    marker: vars.senderAddress,
                    approver: vars.receiverAddress,
                    releaser: vars.receiverAddress,
                    escrow_type: 'single_release',
                    status: 'created',
                    amount: vars.amount,
                    asset_code: 'USDC',
                    escrow_metadata: { property_id: vars.propertyId, engagement_id: vars.engagementId },
                    tenant_id: 'safetrust',
               }
          }
     });
     if (gql.errors) throw Object.assign(new Error("Hasura insert failed"), { gqlErrors: gql.errors });
     return gql.data.insert_trustless_work_escrows_one;
}

async function dbInsertXdr(escrowId, unsignedXdr) {
     const { data: gql } = await hasura.post("", {
          query: INSERT_XDR,
          variables: {
               object: {
                    escrow_transaction_id: escrowId,
                    xdr_type: 'CREATE_ESCROW',
                    unsigned_xdr: unsignedXdr,
                    status: 'PENDING',
               }
          }
     });
     if (gql.errors) throw Object.assign(new Error("Hasura XDR insert failed"), { gqlErrors: gql.errors });
     return gql.data.insert_escrow_xdr_transactions_one;
}

async function dbUpdateEscrowStatus(contractId, status) {
     const { data: gql } = await hasura.post("", {
          query: UPDATE_ESCROW_STATUS,
          variables: { contractId, status },
     });
     if (gql.errors) throw Object.assign(new Error("Hasura update failed"), { gqlErrors: gql.errors });
     return gql.data.update_trustless_work_escrows.returning[0];
}
// ─── Handler ──────────────────────────────────────────────────────────────────

async function createEscrow(req, res) {

     if (req.body.senderAddress) req.body.senderAddress = req.body.senderAddress.trim();
     if (req.body.receiverAddress) req.body.receiverAddress = req.body.receiverAddress.trim();
     if (req.body.propertyId) req.body.propertyId = String(req.body.propertyId).trim();

     const errors = validate(req.body);
     if (errors.length > 0) {
          return res.status(400).json({ error: "Validation failed", details: errors });
     }

     const {
          senderAddress,
          receiverAddress,
          amount,
          propertyId,
          platformAddress = process.env.PLATFORM_STELLAR_ADDRESS,
          platformFee = Number(process.env.PLATFORM_FEE_PERCENT) || 1,
          title = `Security Deposit - Property ${propertyId}`,
          description = `Security deposit escrow for property ${propertyId}`,
     } = req.body;

     if (!platformAddress || !STELLAR_REGEX.test(platformAddress)) {
          return res.status(500).json({
               error: "PLATFORM_STELLAR_ADDRESS in .env is missing or invalid",
          });
     }

     const engagementId = req.body.engagementId || `ST-${propertyId}-${Date.now()}`;

     const payload = {
          signer: senderAddress,
          engagementId,
          title,
          description,
          roles: {
               approver: receiverAddress,
               serviceProvider: senderAddress,
               platformAddress,
               releaseSigner: receiverAddress,
               disputeResolver: platformAddress,
               receiver: receiverAddress,
          },
          amount: Number(amount),
          platformFee: Number(platformFee),
          milestones: [{ description: "Security deposit held until end of tenancy" }],
          trustline: {
               symbol: process.env.TRUSTLINE_SYMBOL || "USDC",
               address: process.env.TRUSTLINE_ADDRESS || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          },
     };

     console.log(`[escrow] Deploying property=${propertyId} amount=${amount}`);


     let pendingRecord;
     try {
          pendingRecord = await dbInsertEscrow({
               contractId: engagementId,
               engagementId,
               propertyId,
               senderAddress,
               receiverAddress,
               amount: Number(amount),
               status: "deploying",
               unsignedXdr: "",          // not yet known
          });
          console.log(`[escrow] Pre-insert OK — db.id=${pendingRecord.id}`);
     } catch (err) {
          console.error("[escrow] Pre-insert to Hasura failed — aborting to avoid orphan:", {
               engagementId,
               payload,
               error: err.message,
               gqlErrors: err.gqlErrors,
          });
          return res.status(500).json({ error: "Failed to initialise escrow record in DB", details: err.message });
     }

     // ── On-chain deployment ───────────────────────────────────────────────────
     let unsignedXdr;
     try {
          const { data } = await trustlessWork.post("/deployer/single-release", payload);

          if (data.status !== "SUCCESS" || !data.unsignedTransaction) {
               // Mark the pre-inserted row as failed so it's easy to find.
               await dbUpdateEscrowStatus(engagementId, "failed").catch((e) =>
                    console.error("[escrow] Could not mark escrow failed in DB:", e.message)
               );
               return res.status(502).json({ error: "Unexpected response from Trustless Work", raw: data });
          }

          unsignedXdr = data.unsignedTransaction;
          console.log(`[escrow] Deploy success — engagementId=${engagementId}`);
     } catch (err) {
          const status = err.response?.status;
          const body = err.response?.data;
          console.error(`[escrow] Trustless Work error HTTP ${status}:`, body || err.message);

          // Update the pre-inserted row to "failed" for reconciliation.
          await dbUpdateEscrowStatus(engagementId, "cancelled").catch((e) =>
               console.error("[escrow] Could not mark escrow failed in DB:", {
                    engagementId,
                    payload,
                    dbError: e.message,
               })
          );

          if (status === 400) return res.status(400).json({ error: "Trustless Work rejected the request", details: body });
          if (status === 401) return res.status(500).json({ error: "Invalid Trustless Work API key" });
          if (status === 429) return res.status(429).json({ error: "Trustless Work rate limit hit" });
          return res.status(500).json({ error: "Failed to deploy escrow", details: body || err.message });
     }

     // ── Update the pre-inserted row to "pending_signature" + store XDR ───────
     try {
          const saved = await dbUpdateEscrowStatus(engagementId, "pending_funding");
          console.log(`[escrow] Updated DB record — id=${saved.id}`);

          const xdrRecord = await dbInsertXdr(saved.id, unsignedXdr);

          return res.status(201).json({
               contractId: engagementId,
               unsignedXdr,
               escrow: { id: saved.id, status: saved.status },
               xdrTransactionId: xdrRecord.id,
          });
     } catch (err) {
          console.error("[escrow] Hasura update failed after successful deployment:", {
               engagementId,
               unsignedXdr,
               payload,
               error: err.message,
               gqlErrors: err.gqlErrors,
          });
          return res.status(207).json({
               warning: "Escrow deployed but DB update failed — manual reconciliation required",
               contractId: engagementId,
               unsignedXdr,
               details: err.message,
          });
     }
}

module.exports = { createEscrow };