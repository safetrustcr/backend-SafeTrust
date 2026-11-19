use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SorobanEscrowState {
    #[serde(alias = "contractId", alias = "id", default)]
    pub contract_id: String,
    pub status: String,
    pub balance: u64, // Stroops (10_000_000 stroops = 1 token unit)
    #[serde(default)]
    pub marker: Option<String>,
    #[serde(default)]
    pub approver: Option<String>,
    #[serde(default)]
    pub releaser: Option<String>,
    #[serde(default)]
    pub asset_code: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DbEscrowState {
    #[serde(alias = "contractId", alias = "contract_id", default)]
    pub contract_id: String,
    #[serde(default)]
    pub id: String,
    pub status: String,
    #[serde(deserialize_with = "deserialize_balance")]
    pub balance: f64, // Standard XLM / token unit
    #[serde(default)]
    pub balance_stroops: Option<u64>,
    #[serde(default)]
    pub marker: String,
    #[serde(default)]
    pub approver: String,
}

fn deserialize_balance<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum NumOrStr {
        Num(f64),
        Str(String),
    }

    match NumOrStr::deserialize(deserializer)? {
        NumOrStr::Num(n) => Ok(n),
        NumOrStr::Str(s) => s.trim().parse::<f64>().map_err(serde::de::Error::custom),
    }
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

