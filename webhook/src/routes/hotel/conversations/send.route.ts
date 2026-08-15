'use strict'

import { Router } from 'express'
import { sendHotelConversationHandler } from './send.handler'

const router = Router()

router.post('/api/hotel/conversations/send', sendHotelConversationHandler)

export default router
