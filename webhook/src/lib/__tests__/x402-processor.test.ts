const {
  validateX402Payment,
  buildPaymentRequirement,
} = require('../../../../crates/x402-processor') as {
  validateX402Payment: (header: string, requiredAmount: number) => string
  buildPaymentRequirement: (
    amountUsdc: number,
    network: string,
    facilitatorUrl: string,
    payTo: string
  ) => string
}

describe('x402-processor native addon', () => {
  it('buildPaymentRequirement generates correct testnet JSON structure', () => {
    const jsonStr = buildPaymentRequirement(
      0.10,
      'stellar:testnet',
      'https://channels.openzeppelin.com/x402/testnet',
      'GSAFETRUSTWALLET'
    )
    const result = JSON.parse(jsonStr)

    expect(result).toEqual({
      scheme: 'exact',
      network: 'stellar:testnet',
      max_amount_usdc: 0.10,
      asset: {
        code: 'USDC',
        contract: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      },
      facilitator_url: 'https://channels.openzeppelin.com/x402/testnet',
      pay_to: 'GSAFETRUSTWALLET',
      description: 'SafeTrust booking fee',
    })
  })

  it('buildPaymentRequirement generates correct mainnet USDC contract', () => {
    const jsonStr = buildPaymentRequirement(
      0.50,
      'stellar:mainnet',
      'https://channels.openzeppelin.com/x402',
      'GMAINNETWALLET'
    )
    const result = JSON.parse(jsonStr)

    expect(result.asset.contract).toBe(
      'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
    )
    expect(result.asset.issuer).toBe(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    )
  })

  it('validateX402Payment returns is_valid: false for missing x402 prefix', () => {
    const jsonStr = validateX402Payment('bearer sometoken', 0.10)
    const result = JSON.parse(jsonStr)

    expect(result.is_valid).toBe(false)
    expect(result.invalid_reason).toContain("must start with 'x402 '")
  })

  it('validateX402Payment returns is_valid: false for non-Stellar network', () => {
    const payload = Buffer.from(
      JSON.stringify({
        scheme: 'exact',
        network: 'ethereum:1',
        payload: 'test-payload',
        amount: 0.10,
        facilitatorUrl: '',
      })
    ).toString('base64')

    const jsonStr = validateX402Payment(`x402 ${payload}`, 0.10)
    const result = JSON.parse(jsonStr)

    expect(result.is_valid).toBe(false)
    expect(result.invalid_reason).toContain('Unsupported network')
  })

  it('validateX402Payment returns is_valid: false for zero or negative amounts', () => {
    // Test zero amount
    const zeroPayload = Buffer.from(
      JSON.stringify({
        scheme: 'exact',
        network: 'stellar:testnet',
        payload: 'test-payload',
        amount: 0,
        facilitatorUrl: '',
      })
    ).toString('base64')

    const zeroResult = JSON.parse(validateX402Payment(`x402 ${zeroPayload}`, 0.10))
    expect(zeroResult.is_valid).toBe(false)
    expect(zeroResult.invalid_reason).toContain('must be positive')

    // Test negative amount
    const negPayload = Buffer.from(
      JSON.stringify({
        scheme: 'exact',
        network: 'stellar:testnet',
        payload: 'test-payload',
        amount: -0.50,
        facilitatorUrl: '',
      })
    ).toString('base64')

    const negResult = JSON.parse(validateX402Payment(`x402 ${negPayload}`, 0.10))
    expect(negResult.is_valid).toBe(false)
    expect(negResult.invalid_reason).toContain('must be positive')
  })

  it('validateX402Payment rejects untrusted/malicious facilitator URLs', () => {
    const payload = Buffer.from(
      JSON.stringify({
        scheme: 'exact',
        network: 'stellar:testnet',
        payload: 'test-payload',
        amount: 0.10,
        facilitatorUrl: 'https://attacker.evil/facilitator',
      })
    ).toString('base64')

    const jsonStr = validateX402Payment(`x402 ${payload}`, 0.10)
    const result = JSON.parse(jsonStr)

    expect(result.is_valid).toBe(false)
    expect(result.invalid_reason).toContain('Untrusted facilitator URL')
  })
})
