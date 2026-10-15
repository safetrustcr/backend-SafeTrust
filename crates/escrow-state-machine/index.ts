interface NativeBindings { validateTransition(from: string, to: string, event: string): boolean; getValidPriorStates(to: string, event: string): string; getTransitionTable(): string; getGraphqlFilter(to: string, event: string): string; }
let bindings: NativeBindings;
'use strict';

try {
  bindings = require('./index.node');
} catch (err) {
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
    { from: ['milestone_approved'], to: 'completed', event: 'funds.released' },
    { from: ['funded', 'active', 'milestone_approved'], to: 'disputed', event: 'dispute.raised' },
    { from: ['disputed'], to: 'resolved', event: 'dispute.resolved' },
    { from: ['created', 'pending_funding', 'funded'], to: 'cancelled', event: 'escrow.cancelled' },
  ];

  function validateStatus(status: string) {
    if (!validStatuses.has(status)) {
      throw new Error(`Unknown escrow status '${status}'`);
    }
  }

  function getValidPriorStates(to: string, event: string) {
    validateStatus(to);
    const matching = transitionRules
      .filter((r) => r.to === to && r.event === event)
      .flatMap((r) => r.from);
    if (!matching.length) {
      throw new Error(`No valid prior states for transition to ${to} via ${event}`);
    }
    return JSON.stringify(matching);
  }

  function validateTransition(from: string, to: string, event: string) {
    validateStatus(from);
    validateStatus(to);
    return transitionRules.some(
      (r) => r.to === to && r.event === event && r.from.includes(from)
    );
  }

  function getTransitionTable() {
    return JSON.stringify(transitionRules);
  }

  function getGraphqlFilter(to: string, event: string) {
    return getValidPriorStates(to, event);
  }

  bindings = {
    validateTransition,
    getValidPriorStates,
    getTransitionTable,
    getGraphqlFilter,
  };
}

export = bindings;
