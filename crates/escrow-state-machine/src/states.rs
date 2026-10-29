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

impl std::str::FromStr for EscrowStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "created" => Ok(Self::Created),
            "pending_funding" => Ok(Self::PendingFunding),
            "funded" => Ok(Self::Funded),
            "active" => Ok(Self::Active),
            "milestone_approved" => Ok(Self::MilestoneApproved),
            "completed" => Ok(Self::Completed),
            "disputed" => Ok(Self::Disputed),
            "resolved" => Ok(Self::Resolved),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(format!("Unknown escrow status: '{}'", other)),
        }
    }
}

impl EscrowStatus {
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Result<Self, String> {
        <Self as std::str::FromStr>::from_str(s)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::PendingFunding => "pending_funding",
            Self::Funded => "funded",
            Self::Active => "active",
            Self::MilestoneApproved => "milestone_approved",
            Self::Completed => "completed",
            Self::Disputed => "disputed",
            Self::Resolved => "resolved",
            Self::Cancelled => "cancelled",
        }
    }

    /// Whether this status is terminal (cannot transition to any other status).
    /// Completed, Resolved, and Cancelled represent final settlement states.
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Resolved | Self::Cancelled)
    }

    /// Whether this status represents an unconfirmed/pending record.
    pub fn is_pending(&self) -> bool {
        matches!(self, Self::Created | Self::PendingFunding)
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

impl std::str::FromStr for WebhookEvent {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "escrow.initialized" => Ok(Self::EscrowInitialized),
            "escrow.funded" => Ok(Self::EscrowFunded),
            "milestone.approved" => Ok(Self::MilestoneApproved),
            "funds.released" => Ok(Self::FundsReleased),
            "dispute.raised" => Ok(Self::DisputeRaised),
            "dispute.resolved" => Ok(Self::DisputeResolved),
            "escrow.cancelled" => Ok(Self::EscrowCancelled),
            other => Err(format!("Unknown webhook event: '{}'", other)),
        }
    }
}

impl WebhookEvent {
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Result<Self, String> {
        <Self as std::str::FromStr>::from_str(s)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EscrowInitialized => "escrow.initialized",
            Self::EscrowFunded => "escrow.funded",
            Self::MilestoneApproved => "milestone.approved",
            Self::FundsReleased => "funds.released",
            Self::DisputeRaised => "dispute.raised",
            Self::DisputeResolved => "dispute.resolved",
            Self::EscrowCancelled => "escrow.cancelled",
        }
    }
}
