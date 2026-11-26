import { Router } from 'express'
import { validate } from '../../../middleware/validate'
import { x402UnlessAuthenticated } from '../../../middleware/x402-unless-authenticated'
import {
  propertyAvailabilityParamsSchema,
  propertyAvailabilityQuerySchema,
  propertySearchQuerySchema,
} from '../../../validation'
import { getPropertyAvailability } from './availability.handler'
import { searchProperties } from './search.handler'

export const PROPERTY_SEARCH_PRICE_USDC = 0.001

const router: Router = Router()

router.get(
  '/search',
  validate(propertySearchQuerySchema, 'query'),
  x402UnlessAuthenticated(PROPERTY_SEARCH_PRICE_USDC),
  searchProperties
)
router.get(
  '/:id/availability',
  validate(propertyAvailabilityParamsSchema, 'params'),
  validate(propertyAvailabilityQuerySchema, 'query'),
  x402UnlessAuthenticated(PROPERTY_SEARCH_PRICE_USDC),
  getPropertyAvailability
)

export default router
