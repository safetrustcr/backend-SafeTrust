import { calculateQuote, calculateStayNights, getQuoteForProperty } from '../quote'
import { NotFoundError, ValidationError } from '../../utils/errors'

describe('Quote Service - Issue 19 & Issue #778', () => {
  describe('calculateStayNights', () => {
    it('calculates nights accurately between two dates', () => {
      const nights = calculateStayNights('2026-12-15', '2026-12-20')
      expect(nights).toBe(5)
    })

    it('calculates 1 night for next day check-out', () => {
      const nights = calculateStayNights('2026-12-15', '2026-12-16')
      expect(nights).toBe(1)
    })

    it('throws ValidationError when check_out is equal to check_in', () => {
      expect(() => {
        calculateStayNights('2026-12-15', '2026-12-15')
      }).toThrow(ValidationError)
    })

    it('throws ValidationError when check_out is before check_in', () => {
      expect(() => {
        calculateStayNights('2026-12-20', '2026-12-15')
      }).toThrow(ValidationError)
    })

    it('throws ValidationError on malformed dates', () => {
      expect(() => {
        calculateStayNights('not-a-date', '2026-12-15')
      }).toThrow(ValidationError)
    })

    it('throws ValidationError on impossible calendar dates like 2027-02-30', () => {
      expect(() => {
        calculateStayNights('2027-02-30', '2027-03-04')
      }).toThrow(ValidationError)
    })
  })

  describe('calculateQuote', () => {
    it('calculates total stay and deposit server-side', () => {
      const quote = calculateQuote(
        { price: 120.5, warranty_deposit: 50.0 },
        '2026-12-15',
        '2026-12-18'
      )

      expect(quote).toEqual({
        nights: 3,
        pricePerNight: '120.50',
        total: '361.50',
        deposit: '50.00',
        asset: 'USDC',
      })
    })

    it('rejects invalid or zero price', () => {
      expect(() => {
        calculateQuote({ price: 0, warranty_deposit: 50 }, '2026-12-15', '2026-12-18')
      }).toThrow(ValidationError)
    })

    it('rejects negative warranty deposit', () => {
      expect(() => {
        calculateQuote({ price: 100, warranty_deposit: -10 }, '2026-12-15', '2026-12-18')
      }).toThrow(ValidationError)
    })
  })

  describe('getQuoteForProperty', () => {
    let mockClient: { query: jest.Mock }

    beforeEach(() => {
      mockClient = {
        query: jest.fn(),
      }
    })

    it('fetches property and returns computed quote result', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'apt-1',
            name: 'Oceanview Loft',
            price: '150.00',
            warranty_deposit: '45.00',
            owner_id: 'host-1',
            is_available: true,
            bedrooms: 2,
          },
        ],
      })

      const quote = await getQuoteForProperty(
        'apt-1',
        '2026-12-15',
        '2026-12-18',
        2,
        mockClient as any
      )

      expect(quote).toEqual({
        propertyId: 'apt-1',
        propertyName: 'Oceanview Loft',
        ownerId: 'host-1',
        checkIn: '2026-12-15',
        checkOut: '2026-12-18',
        nights: 3,
        pricePerNight: '150.00',
        total: '450.00',
        deposit: '45.00',
        asset: 'USDC',
      })
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM safetrust.apartments'),
        ['apt-1']
      )
    })

    it('throws NotFoundError when property is missing', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        getQuoteForProperty('apt-none', '2026-12-15', '2026-12-18', 1, mockClient as any)
      ).rejects.toThrow(NotFoundError)
    })

    it('throws ValidationError when date format is not YYYY-MM-DD', async () => {
      await expect(
        getQuoteForProperty('apt-1', '12/15/2026', '2026-12-18', 1, mockClient as any)
      ).rejects.toThrow(ValidationError)
    })

    it('throws ValidationError when guests is negative or non-integer', async () => {
      await expect(
        getQuoteForProperty('apt-1', '2026-12-15', '2026-12-18', -1, mockClient as any)
      ).rejects.toThrow(ValidationError)
    })
  })
})
