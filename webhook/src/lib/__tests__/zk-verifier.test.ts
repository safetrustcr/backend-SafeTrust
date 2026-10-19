describe('zk-verifier native addon fallback', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('../../../../crates/zk-verifier')
    jest.restoreAllMocks()
  })

  it('logs when the native addon is absent and fails proof requests closed', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation()
    jest.doMock(
      '../../../../crates/zk-verifier',
      () => {
        throw new Error('native addon missing')
      },
      { virtual: true }
    )

    jest.isolateModules(() => {
      const { verifyProofOfFunds } = require('../zk-verifier')

      expect(warning).toHaveBeenCalledWith(
        '[zk-verifier] native addon unavailable; ZK proof verification will fail closed:',
        'native addon missing'
      )
      expect(() =>
        verifyProofOfFunds('proof', 'key', '1', 'commitment')
      ).toThrow('ZK proof verifier is unavailable')
    })
  })
})
