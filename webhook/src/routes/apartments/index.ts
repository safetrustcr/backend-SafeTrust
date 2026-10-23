import { Router } from 'express'
import listRoute from './list.route'
import reportRoute from './report.route'

const router = Router()

router.use('/', listRoute)
router.use('/', reportRoute)

export default router
