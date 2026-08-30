use crate::types::{DbEscrowState, Discrepancy, ReconciliationReport, SorobanEscrowState};

/// Reconcile state between Soroban blockchain ground truth and local database.
pub fn reconcile_escrow(on_chain: &SorobanEscrowState, db: &DbEscrowState) -> ReconciliationReport {
    let mut discrepancies = Vec::new();

    // 1. Status comparison (Critical)
    if db.status != on_chain.status {
        discrepancies.push(Discrepancy {
            field: "status".to_string(),
            in_database: db.status.clone(),
            on_chain: on_chain.status.clone(),
            severity: "critical".to_string(),
        });
    }

    // 2. Balance comparison (Critical) — convert Stroops (10^7 per unit) to XLM standard float
    let on_chain_xlm = (on_chain.balance as f64) / 10_000_000.0;
    if (db.balance - on_chain_xlm).abs() > 0.0001 {
        discrepancies.push(Discrepancy {
            field: "balance".to_string(),
            in_database: db.balance.to_string(),
            on_chain: on_chain_xlm.to_string(),
            severity: "critical".to_string(),
        });
    }

    // 3. Marker comparison (Warning)
    let on_chain_marker = on_chain.marker.as_deref().unwrap_or("");
    if db.marker != on_chain_marker {
        discrepancies.push(Discrepancy {
            field: "marker".to_string(),
            in_database: db.marker.clone(),
            on_chain: on_chain_marker.to_string(),
            severity: "warning".to_string(),
        });
    }

    // 4. Approver comparison (Warning)
    let on_chain_approver = on_chain.approver.as_deref().unwrap_or("");
    if db.approver != on_chain_approver {
        discrepancies.push(Discrepancy {
            field: "approver".to_string(),
            in_database: db.approver.clone(),
            on_chain: on_chain_approver.to_string(),
            severity: "warning".to_string(),
        });
    }

    let contract_id = if !on_chain.contract_id.is_empty() {
        on_chain.contract_id.clone()
    } else {
        db.contract_id.clone()
    };

    ReconciliationReport {
        contract_id,
        in_sync: discrepancies.is_empty(),
        discrepancies,
    }
}
