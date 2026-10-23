use crate::states::{EscrowStatus, WebhookEvent};
use crate::transitions::transition_table;

/// Returns the valid FROM states for a given target status + event.
///
/// Used to generate the Hasura GraphQL `_in: [...]` filter. Returns an error
/// when no rule matches the (target, event) pair, e.g. a target that can only
/// be reached via a different event.
pub fn valid_prior_states(
    target: &EscrowStatus,
    event: &WebhookEvent,
) -> Result<Vec<EscrowStatus>, String> {
    let matching: Vec<EscrowStatus> = transition_table()
        .into_iter()
        .filter(|rule| &rule.to == target && &rule.event == event)
        .flat_map(|rule| rule.from.to_vec())
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

/// Validates that a specific from → to transition is legal.
pub fn is_valid_transition(from: &EscrowStatus, to: &EscrowStatus, event: &WebhookEvent) -> bool {
    transition_table()
        .iter()
        .any(|rule| &rule.to == to && &rule.event == event && rule.from.contains(from))
}

/// Validates whether an escrow in `from` status can legally transition to `to` status.
///
/// Terminal State Rules & Ordering Invariants:
/// -------------------------------------------
/// - Terminal states (`completed`, `resolved`, `cancelled`) represent irrevocable on-chain
///   settlement outcomes where funds have been paid out, refunded, or split.
/// - Terminal states CANNOT be ordered by numeric status rank (e.g., rank(cancelled) vs rank(completed)):
///   a numeric ranking implies a total ordering where a higher-ranked status could overwrite a lower-ranked
///   one. In reality, once completed or resolved, an escrow is permanently final.
/// - Terminal states (`completed`, `resolved`) must NEVER be overwritten regardless of sequence number.
/// - `cancelled` must NOT be reachable from `completed` or `resolved`.
/// - Terminal states must never transition to non-terminal states regardless of incoming sequence number.
/// - For non-terminal states `from != to`, the transition is valid if and only if there exists a transition rule
///   in `transition_table()` permitting `from -> to`.
/// - Reaffirming the same state (`from == to`) is allowed (idempotent write/reaffirmation), UNLESS `from` is
///   a confirmed terminal state being targeted by an illegal overwrite.
pub fn can_transition_status(from: &EscrowStatus, to: &EscrowStatus) -> bool {
    if from == to {
        return true;
    }

    // Terminal states cannot transition to ANY other state.
    if from.is_terminal() {
        return false;
    }

    // Explicit invariant: cancelled is not reachable from completed or resolved.
    if (*from == EscrowStatus::Completed || *from == EscrowStatus::Resolved)
        && *to == EscrowStatus::Cancelled
    {
        return false;
    }

    // Verify against the canonical transition table.
    transition_table()
        .iter()
        .any(|rule| &rule.to == to && rule.from.contains(from))
}

/// Generates the Hasura GraphQL `_in` filter values for a target status +
/// event, as a list of snake_case status strings.
pub fn graphql_in_filter(
    target: &EscrowStatus,
    event: &WebhookEvent,
) -> Result<Vec<String>, String> {
    Ok(valid_prior_states(target, event)?
        .iter()
        .map(|s| s.as_str().to_string())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::states::{EscrowStatus as S, WebhookEvent as E};

    #[test]
    fn valid_transitions_are_recognized() {
        assert!(is_valid_transition(
            &S::Created,
            &S::Funded,
            &E::EscrowFunded
        ));
        assert!(is_valid_transition(
            &S::PendingFunding,
            &S::Funded,
            &E::EscrowFunded
        ));
        assert!(is_valid_transition(
            &S::Funded,
            &S::Active,
            &E::EscrowFunded
        ));
        assert!(is_valid_transition(
            &S::Funded,
            &S::MilestoneApproved,
            &E::MilestoneApproved
        ));
        assert!(is_valid_transition(
            &S::MilestoneApproved,
            &S::Completed,
            &E::FundsReleased
        ));
        assert!(is_valid_transition(
            &S::Funded,
            &S::Disputed,
            &E::DisputeRaised
        ));
        assert!(is_valid_transition(
            &S::Disputed,
            &S::Resolved,
            &E::DisputeResolved
        ));
        // A dispute may end with funds returned to the tenant.
        assert!(is_valid_transition(
            &S::Disputed,
            &S::Cancelled,
            &E::EscrowCancelled
        ));
    }

    #[test]
    fn illegal_transitions_are_rejected() {
        // completed → created is not a legal transition
        assert!(!is_valid_transition(
            &S::Completed,
            &S::Created,
            &E::EscrowInitialized
        ));
        // funded → completed is not a direct transition
        assert!(!is_valid_transition(
            &S::Funded,
            &S::Completed,
            &E::FundsReleased
        ));
        // wrong event
        assert!(!is_valid_transition(
            &S::Funded,
            &S::Active,
            &E::EscrowInitialized
        ));
        // a completed escrow cannot be cancelled
        assert!(!is_valid_transition(
            &S::Completed,
            &S::Cancelled,
            &E::EscrowCancelled
        ));
    }

    #[test]
    fn funded_prior_states_match_spec() {
        let priors = valid_prior_states(&S::Funded, &E::EscrowFunded).unwrap();
        let as_strings: Vec<&str> = priors.iter().map(|s| s.as_str()).collect();
        assert_eq!(as_strings, vec!["created", "pending_funding"]);
    }

    #[test]
    fn unknown_target_event_pair_errors() {
        assert!(valid_prior_states(&S::Completed, &E::DisputeRaised).is_err());
    }

    #[test]
    fn table_covers_every_status_as_a_target() {
        let targets: Vec<S> = transition_table().into_iter().map(|r| r.to).collect();
        for status in crate::transitions::all_statuses() {
            if status == S::PendingFunding || status == S::Active {
                // These variants have no inbound transitions by design.
                continue;
            }
            assert!(
                targets.contains(&status),
                "status {:?} has no inbound transition rule",
                status
            );
        }
    }

    #[test]
    fn terminal_states_cannot_transition_to_any_other_state() {
        for terminal in [S::Completed, S::Resolved, S::Cancelled] {
            for other in crate::transitions::all_statuses() {
                if other != terminal {
                    assert!(
                        !can_transition_status(&terminal, &other),
                        "terminal state {:?} must not transition to {:?}",
                        terminal,
                        other
                    );
                }
            }
        }
    }

    #[test]
    fn completed_cannot_be_cancelled() {
        assert!(!can_transition_status(&S::Completed, &S::Cancelled));
        assert!(!can_transition_status(&S::Resolved, &S::Cancelled));
    }

    #[test]
    fn can_transition_status_valid_lifecycle() {
        assert!(can_transition_status(&S::Created, &S::Funded));
        assert!(can_transition_status(&S::Funded, &S::Active));
        assert!(can_transition_status(&S::Active, &S::MilestoneApproved));
        assert!(can_transition_status(&S::MilestoneApproved, &S::Completed));
        assert!(can_transition_status(&S::Funded, &S::Disputed));
        assert!(can_transition_status(&S::Disputed, &S::Resolved));
        assert!(can_transition_status(&S::Disputed, &S::Cancelled));
        assert!(can_transition_status(&S::Created, &S::Cancelled));
        // Idempotent reaffirmation
        assert!(can_transition_status(&S::Funded, &S::Funded));
    }
}
