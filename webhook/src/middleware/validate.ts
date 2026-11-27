'use strict'

import { NextFunction, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'

export type RequestDataSource = 'body' | 'query'

export function validate<TSchema extends z.ZodType>(
  schema: TSchema,
  source: RequestDataSource = 'body'
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      const fields: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const field = issue.path.length > 0 ? issue.path.join('.') : '_root'
        if (fields[field] === undefined) fields[field] = issue.message
      }
      res.status(400).json({ error: 'validation_failed', fields })
      return
    }

    Object.defineProperty(req, source, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: result.data,
    })
    next()
  }
}
