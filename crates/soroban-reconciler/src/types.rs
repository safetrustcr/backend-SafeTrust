use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SorobanEscrowState {
    #[serde(alias = "contractId", alias = "id", default)]
    pub contract_id: String,
    pub status: String,
    pub balance: u64, // Stroops (10_000_000 stroops = 1 XLM)
    pub marker: Option<String>,
    pub approver: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DbEscrowState {
    #[serde(alias = "contractId", alias = "contract_id", default)]
    pub contract_id: String,
    #[serde(default)]
    pub id: String,
    pub status: String,
    pub balance: f64, // Standard XLM / token unit
    #[serde(default)]
    pub marker: String,
    #[serde(default)]
    pub approver: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Discrepancy {
    pub field: String,
    pub in_database: String,
    pub on_chain: String,
    pub severity: String, // "critical" | "warning"
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ReconciliationReport {
    pub contract_id: String,
    pub in_sync: bool,
    pub discrepancies: Vec<Discrepancy>,
}
