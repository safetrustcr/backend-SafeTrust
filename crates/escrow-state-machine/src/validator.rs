use crate::states::{EscrowStatus, WebhookEvent};
use crate::transitions::transition_table;

/// Returns the valid FROM states for a given target status + event.
///
/// Used to generate the Hasura GraphQL `_in: [...]` filter. Returns an error
/// when no rule matches the (target, event) pair, e.g. a target that can only
/// be reached via a different event.
pub fn valid_prior_states(
    target: &EscrowStatus,
    event:  &WebhookEvent,
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

/// Generates the Hasura GraphQL `_in` filter values for a target status +
/// event, as a list of snake_case status strings.
pub fn graphql_in_filter(
    target: &EscrowStatus,
    event:  &WebhookEvent,
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
        assert!(is_valid_transition(&S::Created, &S::Funded, &E::EscrowFunded));
        assert!(is_valid_transition(&S::PendingFunding, &S::Funded, &E::EscrowFunded));
        assert!(is_valid_transition(&S::Funded, &S::Active, &E::EscrowFunded));
        assert!(is_valid_transition(&S::Funded, &S::MilestoneApproved, &E::MilestoneApproved));
        assert!(is_valid_transition(&S::MilestoneApproved, &S::Completed, &E::FundsReleased));
        assert!(is_valid_transition(&S::Funded, &S::Disputed, &E::DisputeRaised));
        assert!(is_valid_transition(&S::Disputed, &S::Resolved, &E::DisputeResolved));
    }

    #[test]
    fn illegal_transitions_are_rejected() {
        // completed → created is not a legal transition
        assert!(!is_valid_transition(&S::Completed, &S::Created, &E::EscrowInitialized));
        // funded → completed is not a direct transition
        assert!(!is_valid_transition(&S::Funded, &S::Completed, &E::FundsReleased));
        // wrong event
        assert!(!is_valid_transition(&S::Funded, &S::Active, &E::EscrowInitialized));
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
}
