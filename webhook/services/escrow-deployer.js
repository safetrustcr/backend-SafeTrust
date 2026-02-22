"use strict";

const axios = require("axios");

const trustlessWork = axios.create({
     baseURL: process.env.TRUSTLESS_WORK_API_URL || "https://dev.api.trustlesswork.com",
     timeout: 15000,
     headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.TRUSTLESS_WORK_API_KEY,
     },
});

const hasura = axios.create({
     baseURL: process.env.HASURA_GRAPHQL_URL || "http://localhost:8080/v1/graphql",
     timeout: 10000,
     headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": process.env.HASURA_ADMIN_SECRET,
     },
});

const INSERT_ESCROW = `
  mutation InsertEscrow(
    $contractId: String!
    $engagementId: String!
    $propertyId: String!
    $senderAddress: String!
    $receiverAddress: String!
    $amount: numeric!
    $status: String!
    $unsignedXdr: String!
  ) {
    insert_escrows_one(object: {
      contract_id:      $contractId
      engagement_id:    $engagementId
      property_id:      $propertyId
      sender_address:   $senderAddress
      receiver_address: $receiverAddress
      amount:           $amount
      status:           $status
      unsigned_xdr:     $unsignedXdr
    }) {
      id
      contract_id
      engagement_id
      property_id
      sender_address
      receiver_address
      amount
      status
      unsigned_xdr
      created_at
    }
  }
`;

/**
 * Update an existing escrow row (identified by engagementId / contractId).
 * Used to flip status to "pending_signature" on success or "failed" on error.
 */
const UPDATE_ESCROW_STATUS = `
  mutation UpdateEscrowStatus(
    $engagementId: String!
    $status: String!
    $unsignedXdr: String!
  ) {
    update_escrows(
      where: { engagement_id: { _eq: $engagementId } }
      _set: { status: $status, unsigned_xdr: $unsignedXdr }
    ) {
      returning {
        id
        contract_id
        engagement_id
        property_id
        sender_address
        receiver_address
        amount
        status
        unsigned_xdr
        created_at
      }
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
     const { data: gql } = await hasura.post("", { query: INSERT_ESCROW, variables: vars });
     if (gql.errors) throw Object.assign(new Error("Hasura insert failed"), { gqlErrors: gql.errors });
     return gql.data.insert_escrows_one;
}

async function dbUpdateEscrowStatus(engagementId, status, unsignedXdr) {
     const { data: gql } = await hasura.post("", {
          query: UPDATE_ESCROW_STATUS,
          variables: { engagementId, status, unsignedXdr },
     });
     if (gql.errors) throw Object.assign(new Error("Hasura update failed"), { gqlErrors: gql.errors });
     return gql.data.update_escrows.returning[0];
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
               await dbUpdateEscrowStatus(engagementId, "failed", "").catch((e) =>
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
          await dbUpdateEscrowStatus(engagementId, "failed", "").catch((e) =>
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
          const saved = await dbUpdateEscrowStatus(engagementId, "pending_signature", unsignedXdr);
          console.log(`[escrow] Updated DB record — id=${saved.id}`);

          return res.status(201).json({
               contractId: engagementId,
               unsignedXdr,
               engagementId,
               propertyId,
               senderAddress,
               receiverAddress,
               amount: Number(amount),
               escrow: saved,
          });
     } catch (err) {
          // On-chain escrow exists; log everything needed for manual reconciliation.
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