import { Router } from 'express'
import { initializeEscrowHandler } from './initialize.handler'
import { requireX402Payment } from '../../middleware/x402-payment.middleware'
import { validate } from '../../middleware/validate'
import { escrowInitializationSchema } from '../../validation'

const router = Router()

router.post(
  '/api/escrows/initialize',
  requireX402Payment(0.10),
  validate(escrowInitializationSchema),
  initializeEscrowHandler
)

export default router
module.exports = router
module.exports.default = router
