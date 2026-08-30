use crate::states::{EscrowStatus, WebhookEvent};

/// A valid state transition in the SafeTrust escrow lifecycle.
///
/// `from` is a `'static` slice so the rule can be embedded in the compiled
/// table without allocation. Every legal transition is listed exactly once;
/// any transition NOT in `transition_table()` is INVALID by definition.
pub struct TransitionRule {
    pub from:   &'static [EscrowStatus],
    pub to:     EscrowStatus,
    pub event:  WebhookEvent,
    pub reason: &'static str,
}

// `from` slices are referenced by `TransitionRule` and must outlive the table,
// so they are declared as `'static` constants here.
const FROM_PENDING_FUNDING:       &[EscrowStatus] = &[EscrowStatus::PendingFunding];
const FROM_CREATED_OR_PENDING:    &[EscrowStatus] = &[EscrowStatus::Created, EscrowStatus::PendingFunding];
const FROM_FUNDED:                &[EscrowStatus] = &[EscrowStatus::Funded];
const FROM_ACTIVE_OR_FUNDED:      &[EscrowStatus] = &[EscrowStatus::Active, EscrowStatus::Funded];
const FROM_MILESTONE_APPROVED:    &[EscrowStatus] = &[EscrowStatus::MilestoneApproved];
const FROM_FUNDED_ACTIVE_MILESTONE: &[EscrowStatus] =
    &[EscrowStatus::Funded, EscrowStatus::Active, EscrowStatus::MilestoneApproved];
const FROM_DISPUTED:              &[EscrowStatus] = &[EscrowStatus::Disputed];
const FROM_CREATED_PENDING_FUNDED: &[EscrowStatus] =
    &[EscrowStatus::Created, EscrowStatus::PendingFunding, EscrowStatus::Funded];

/// The canonical SafeTrust escrow state machine.
///
/// The `for target in all_statuses()` loop drives an exhaustive `match` over
/// `EscrowStatus`. Adding a new `EscrowStatus` variant is a COMPILE ERROR
/// here until its incoming `TransitionRule`s are added to the `match`, which
/// is the whole point: impossible transitions cannot be represented.
pub fn transition_table() -> Vec<TransitionRule> {
    use EscrowStatus::*;

    let mut rules: Vec<TransitionRule> = Vec::new();

    for target in all_statuses() {
        match target {
            Created => rules.push(TransitionRule {
                from:   FROM_PENDING_FUNDING,
                to:     Created,
                event:  WebhookEvent::EscrowInitialized,
                reason: "Escrow deployed on Stellar — awaiting guest funding",
            }),
            // `pending_funding` is the pre-creation onboarding state and has
            // no inbound transition in the lifecycle.
            PendingFunding => {}
            Funded => {
                rules.push(TransitionRule {
                    from:   FROM_CREATED_OR_PENDING,
                    to:     Funded,
                    event:  WebhookEvent::EscrowFunded,
                    reason: "Guest deposited USDC — funds locked in escrow contract",
                });
                rules.push(TransitionRule {
                    from:   FROM_FUNDED,
                    to:     Active,
                    event:  WebhookEvent::EscrowFunded,
                    reason: "Escrow fully funded — booking is confirmed and active",
                });
            }
            // `active` is reached implicitly when fully funded; no separate
            // inbound event transition is modeled.
            Active => {}
            MilestoneApproved => rules.push(TransitionRule {
                from:   FROM_ACTIVE_OR_FUNDED,
                to:     MilestoneApproved,
                event:  WebhookEvent::MilestoneApproved,
                reason: "Host approved milestone (check-in or check-out)",
            }),
            Completed => rules.push(TransitionRule {
                from:   FROM_MILESTONE_APPROVED,
                to:     Completed,
                event:  WebhookEvent::FundsReleased,
                reason: "All milestones approved — funds released to host",
            }),
            Disputed => rules.push(TransitionRule {
                from:   FROM_FUNDED_ACTIVE_MILESTONE,
                to:     Disputed,
                event:  WebhookEvent::DisputeRaised,
                reason: "Guest or host raised a dispute",
            }),
            Resolved => rules.push(TransitionRule {
                from:   FROM_DISPUTED,
                to:     Resolved,
                event:  WebhookEvent::DisputeResolved,
                reason: "Dispute resolved by arbitrator",
            }),
            Cancelled => rules.push(TransitionRule {
                from:   FROM_CREATED_PENDING_FUNDED,
                to:     Cancelled,
                event:  WebhookEvent::EscrowCancelled,
                reason: "Booking cancelled before check-in",
            }),
        }
    }

    rules
}

/// All `EscrowStatus` variants, in declaration order.
pub fn all_statuses() -> Vec<EscrowStatus> {
    use EscrowStatus::*;
    vec![
        Created,
        PendingFunding,
        Funded,
        Active,
        MilestoneApproved,
        Completed,
        Disputed,
        Resolved,
        Cancelled,
    ]
}
