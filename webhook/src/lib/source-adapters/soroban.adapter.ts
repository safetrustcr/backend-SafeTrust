type QueryEscrowState = (contractId: string, network: string) => string
type ReconcileBatch = (onChainJson: string, dbJson: string) => string

let queryEscrowStateBatch: QueryEscrowState | null = null
let reconcileBatch: ReconcileBatch | null = null

try {
  const sorobanReconciler = require('../../../../crates/soroban-reconciler')
  queryEscrowStateBatch = sorobanReconciler.queryEscrowStateBatch
  reconcileBatch = sorobanReconciler.reconcileBatch
} catch (err) {
  const error = err as Error
  console.warn(
    '[reconciliation] ⚠️ soroban-reconciler native addon unavailable:',
    error.message
  )
}

export function setSorobanReconcilerAddon(addon: {
  queryEscrowStateBatch?: QueryEscrowState | null
  reconcileBatch?: ReconcileBatch | null
} | null): void {
  if (addon) {
    queryEscrowStateBatch = addon.queryEscrowStateBatch ?? null
    reconcileBatch = addon.reconcileBatch ?? null
  } else {
    queryEscrowStateBatch = null
    reconcileBatch = null
  }
}

export function hasSorobanReconciler(): boolean {
  return Boolean(queryEscrowStateBatch && reconcileBatch)
}

export function querySorobanEscrow(contractId: string, network: string): string {
  if (!queryEscrowStateBatch) {
    throw new Error('soroban-reconciler native addon is not available')
  }
  return queryEscrowStateBatch(contractId, network)
}

export function reconcileSorobanState(onChainJson: string, dbJson: string): string {
  if (!reconcileBatch) {
    throw new Error('soroban-reconciler native addon is not available')
  }
  return reconcileBatch(onChainJson, dbJson)
}
