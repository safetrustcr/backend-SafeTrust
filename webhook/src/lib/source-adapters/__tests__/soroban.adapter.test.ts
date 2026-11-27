import {
  hasSorobanReconciler,
  querySorobanEscrow,
  reconcileSorobanState,
  setSorobanReconcilerAddon,
} from '../soroban.adapter'

describe('Soroban source adapter', () => {
  afterEach(() => setSorobanReconcilerAddon(null))

  it('dispatches state queries and reconciliation to the configured addon', () => {
    const queryEscrowStateBatch = jest.fn(() => '{"status":"funded","balance":1}')
    const reconcileBatch = jest.fn(() => '{"in_sync":true,"discrepancies":[]}')
    setSorobanReconcilerAddon({ queryEscrowStateBatch, reconcileBatch })

    expect(hasSorobanReconciler()).toBe(true)
    expect(querySorobanEscrow('C1', 'testnet')).toBe('{"status":"funded","balance":1}')
    expect(reconcileSorobanState('{}', '{}')).toBe('{"in_sync":true,"discrepancies":[]}')
    expect(queryEscrowStateBatch).toHaveBeenCalledWith('C1', 'testnet')
  })
})
