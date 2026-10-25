"use strict";
let bindings;
'use strict';
try {
    bindings = require('./index.node');
}
catch (err) {
    const validStatuses = new Set([
        'created',
        'pending_funding',
        'funded',
        'active',
        'milestone_approved',
        'completed',
        'disputed',
        'resolved',
        'cancelled',
    ]);
    const transitionRules = [
        { from: ['pending_funding'], to: 'created', event: 'escrow.initialized' },
        { from: ['created', 'pending_funding'], to: 'funded', event: 'escrow.funded' },
        { from: ['funded'], to: 'active', event: 'escrow.funded' },
        { from: ['active', 'funded'], to: 'milestone_approved', event: 'milestone.approved' },
        { from: ['funded', 'milestone_approved'], to: 'completed', event: 'funds.released' },
        { from: ['funded', 'active', 'milestone_approved'], to: 'disputed', event: 'dispute.raised' },
        { from: ['disputed'], to: 'resolved', event: 'dispute.resolved' },
        { from: ['created', 'pending_funding', 'funded', 'disputed'], to: 'cancelled', event: 'escrow.cancelled' },
    ];
    /**
     * Validates that a status string belongs to the known escrow status set.
     *
     * @param status - Escrow status to validate
     */
    function validateStatus(status) {
        if (!validStatuses.has(status)) {
            throw new Error(`Unknown escrow status '${status}'`);
        }
    }
    /**
     * Returns a JSON-serialized array of valid prior states for a target status and event.
     *
     * @param to - Target status
     * @param event - Transition event name
     * @returns JSON string of valid prior status strings
     */
    function getValidPriorStates(to, event) {
        validateStatus(to);
        const matching = transitionRules
            .filter((r) => r.to === to && r.event === event)
            .flatMap((r) => r.from);
        if (!matching.length) {
            throw new Error(`No valid prior states for transition to ${to} via ${event}`);
        }
        return JSON.stringify(matching);
    }
    /**
     * Checks whether a state transition is permitted by the state machine.
     *
     * @param from - Current status
     * @param to - Target status
     * @param event - Transition event name
     * @returns True if legal, false otherwise
     */
    function validateTransition(from, to, event) {
        validateStatus(from);
        validateStatus(to);
        return transitionRules.some((r) => r.to === to && r.event === event && r.from.includes(from));
    }
    /**
     * Returns the complete canonical transition table as a JSON string.
     *
     * @returns JSON string of transition rules
     */
    function getTransitionTable() {
        return JSON.stringify(transitionRules);
    }
    /**
     * Returns a JSON-serialized GraphQL filter for valid prior states.
     *
     * @param to - Target status
     * @param event - Transition event name
     * @returns JSON string of matching prior states
     */
    function getGraphqlFilter(to, event) {
        return getValidPriorStates(to, event);
    }
    bindings = {
        validateTransition,
        getValidPriorStates,
        getTransitionTable,
        getGraphqlFilter,
    };
}
module.exports = bindings;
