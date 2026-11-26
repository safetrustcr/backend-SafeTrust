import { calculatePropertyQuote } from '../property-quote'

describe('calculatePropertyQuote', () => {
  it('uses exact decimal arithmetic and the listing warranty deposit', () => {
    expect(calculatePropertyQuote({
      nightlyPrice: '30.00',
      warrantyDeposit: '45.00',
      checkIn: '2099-12-15',
      checkOut: '2099-12-20',
    })).toEqual({
      nights: 5,
      nightlyPrice: '30.00',
      total: '150.00',
      deposit: '45.00',
    })
  })

  it('does not use floating-point arithmetic for fractional prices', () => {
    expect(calculatePropertyQuote({
      nightlyPrice: '0.01',
      warrantyDeposit: '1.99',
      checkIn: '2099-01-01',
      checkOut: '2099-01-04',
    })).toMatchObject({
      total: '0.03',
      deposit: '1.99',
    })
  })

  it.each([
    ['2099-02-30', '2099-03-03'],
    ['2099-12-20', '2099-12-15'],
  ])('rejects invalid date ranges (%s to %s)', (checkIn, checkOut) => {
    expect(() => calculatePropertyQuote({
      nightlyPrice: '30.00',
      warrantyDeposit: '45.00',
      checkIn,
      checkOut,
    })).toThrow(RangeError)
  })
})
