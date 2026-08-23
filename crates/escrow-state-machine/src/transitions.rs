use crate::states::{EscrowStatus, WebhookEvent};

/// A valid state transition in the SafeTrust escrow lifecycle.
/// The compiler exhaustively checks all arms — adding a new EscrowStatus
/// forces a compile error here until the transition table is updated.
pub struct TransitionRule {
    pub from:     &'static [EscrowStatus],
    pub to:       EscrowStatus,
    pub event:    WebhookEvent,
    pub reason:   &'static str,
}

/// The canonical SafeTrust escrow state machine.
/// Every valid transition is listed exactly once.
/// Any transition NOT in this table is INVALID by definition.
pub fn transition_table() -> Vec<TransitionRule> {
    use EscrowStatus::*;
    use WebhookEvent::*;

    let mut rules = Vec::new();

    let all_states = [
        Created, PendingFunding, Funded, Active, MilestoneApproved,
        Completed, Disputed, Resolved, Cancelled,
    ];

    for state in all_states {
        match state {
            Created => rules.push(TransitionRule {
                from:   &[PendingFunding],
                to:     Created,
                event:  EscrowInitialized,
                reason: "Escrow deployed on Stellar — awaiting guest funding",
            }),
            PendingFunding => {
                // Terminal/initial state with no incoming transitions in this table
            }
            Funded => rules.push(TransitionRule {
                from:   &[Created, PendingFunding],
                to:     Funded,
                event:  EscrowFunded,
                reason: "Guest deposited USDC — funds locked in escrow contract",
            }),
            Active => rules.push(TransitionRule {
                from:   &[Funded],
                to:     Active,
                event:  EscrowFunded,
                reason: "Escrow fully funded — booking is confirmed and active",
            }),
            MilestoneApproved => rules.push(TransitionRule {
                from:   &[Active, Funded],
                to:     MilestoneApproved,
                event:  MilestoneApproved,
                reason: "Host approved milestone (check-in or check-out)",
            }),
            Completed => rules.push(TransitionRule {
                from:   &[MilestoneApproved],
                to:     Completed,
                event:  FundsReleased,
                reason: "All milestones approved — funds released to host",
            }),
            Disputed => rules.push(TransitionRule {
                from:   &[Funded, Active, MilestoneApproved],
                to:     Disputed,
                event:  DisputeRaised,
                reason: "Guest or host raised a dispute",
            }),
            Resolved => rules.push(TransitionRule {
                from:   &[Disputed],
                to:     Resolved,
                event:  DisputeResolved,
                reason: "Dispute resolved by arbitrator",
            }),
            Cancelled => rules.push(TransitionRule {
                from:   &[Created, PendingFunding, Funded],
                to:     Cancelled,
                event:  EscrowCancelled,
                reason: "Booking cancelled before check-in",
            }),
        }
    }

    rules
}

/// Returns the valid FROM states for a given target status + event.
/// Used to generate the Hasura GraphQL `_in: [...]` filter.
pub fn valid_prior_states(
    target: &EscrowStatus,
    event:  &WebhookEvent,
) -> Result<Vec<EscrowStatus>, String> {
    let table = transition_table();

    let matching: Vec<EscrowStatus> = table
        .iter()
        .filter(|rule| &rule.to == target && &rule.event == event)
        .flat_map(|rule| rule.from.iter().cloned())
        .collect();

    if matching.is_empty() {
        Err(format!(
            "No valid prior states for transition to {:?} via {:?}",
            target, event
        ))
    } else {
        Ok(matching)
    }
}

/// Validates that a specific from→to transition is legal.
pub fn is_valid_transition(
    from:  &EscrowStatus,
    to:    &EscrowStatus,
    event: &WebhookEvent,
) -> bool {
    transition_table().iter().any(|rule| {
        &rule.to == to
            && &rule.event == event
            && rule.from.contains(from)
    })
}
