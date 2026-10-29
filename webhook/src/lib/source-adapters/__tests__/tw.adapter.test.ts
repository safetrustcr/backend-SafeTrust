jest.mock('https', () => ({ request: jest.fn() }))

import { EventEmitter } from 'events'
import { fetchEscrowsByContractIds } from '../tw.adapter'

const https = require('https')

describe('TrustlessWork source adapter', () => {
  it('fetches escrow records for the requested contract IDs', async () => {
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number
      setEncoding: jest.Mock
    }
    response.statusCode = 200
    response.setEncoding = jest.fn()

    const request = new EventEmitter() as EventEmitter & {
      setTimeout: jest.Mock
      end: jest.Mock
    }
    request.setTimeout = jest.fn()
    request.end = jest.fn(() => {
      process.nextTick(() => {
        response.emit('data', JSON.stringify({ escrows: [{ contractId: 'C1' }] }))
        response.emit('end')
      })
    })

    https.request.mockImplementation(
      (_options: unknown, callback: (res: typeof response) => void) => {
        callback(response)
        return request
      }
    )

    await expect(fetchEscrowsByContractIds(['C1'])).resolves.toEqual([
      { contractId: 'C1' },
    ])
  })
})
