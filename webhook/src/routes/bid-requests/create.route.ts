'use strict'

import { Router, RequestHandler } from 'express'
import { createBidRequestHandler } from './create.handler'
import { validate } from '../../middleware/validate'
import { createBidRequestSchema } from '../../validation'

const router = Router()

router.post('/', validate(createBidRequestSchema), createBidRequestHandler as unknown as RequestHandler)

export default router
