/// Every valid escrow status in SafeTrust.
///
/// Adding a new status here requires updating `TransitionRule` construction
/// inside `transition_table()` — the exhaustive `match` in that function is a
/// compile error until every variant (including the new one) has its incoming
/// transitions listed.
#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EscrowStatus {
    Created,
    PendingFunding,
    Funded,
    Active,
    MilestoneApproved,
    Completed,
    Disputed,
    Resolved,
    Cancelled,
}

impl EscrowStatus {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "created"            => Ok(Self::Created),
            "pending_funding"    => Ok(Self::PendingFunding),
            "funded"             => Ok(Self::Funded),
            "active"             => Ok(Self::Active),
            "milestone_approved" => Ok(Self::MilestoneApproved),
            "completed"          => Ok(Self::Completed),
            "disputed"           => Ok(Self::Disputed),
            "resolved"           => Ok(Self::Resolved),
            "cancelled"          => Ok(Self::Cancelled),
            other => Err(format!("Unknown escrow status: '{}'", other)),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Created           => "created",
            Self::PendingFunding    => "pending_funding",
            Self::Funded            => "funded",
            Self::Active            => "active",
            Self::MilestoneApproved => "milestone_approved",
            Self::Completed         => "completed",
            Self::Disputed          => "disputed",
            Self::Resolved          => "resolved",
            Self::Cancelled         => "cancelled",
        }
    }
}

/// Every valid webhook event type in SafeTrust.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebhookEvent {
    EscrowInitialized,
    EscrowFunded,
    MilestoneApproved,
    FundsReleased,
    DisputeRaised,
    DisputeResolved,
    EscrowCancelled,
}

impl WebhookEvent {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "escrow.initialized"  => Ok(Self::EscrowInitialized),
            "escrow.funded"       => Ok(Self::EscrowFunded),
            "milestone.approved"  => Ok(Self::MilestoneApproved),
            "funds.released"      => Ok(Self::FundsReleased),
            "dispute.raised"      => Ok(Self::DisputeRaised),
            "dispute.resolved"    => Ok(Self::DisputeResolved),
            "escrow.cancelled"    => Ok(Self::EscrowCancelled),
            other => Err(format!("Unknown webhook event: '{}'", other)),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EscrowInitialized => "escrow.initialized",
            Self::EscrowFunded      => "escrow.funded",
            Self::MilestoneApproved => "milestone.approved",
            Self::FundsReleased     => "funds.released",
            Self::DisputeRaised     => "dispute.raised",
            Self::DisputeResolved   => "dispute.resolved",
            Self::EscrowCancelled   => "escrow.cancelled",
        }
    }
}
