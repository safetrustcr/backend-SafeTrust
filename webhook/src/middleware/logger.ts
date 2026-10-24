import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
}

declare global {
  namespace Express {
    interface Request {
      context: RequestContext;
    }
  }
}

type Level = 'debug' | 'info' | 'warn' | 'error';

const write = (level: Level, payload: Record<string, unknown>) => {
  const line = JSON.stringify({ level, time: new Date().toISOString(), ...payload });
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
};

const serializeError = (err: unknown) => {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
};

/**
 * Structured logger. Every entry should carry a requestId when available.
 * Pass the request (or its context) via `forRequest` to bind it automatically.
 */
export const logger = {
  log: (level: Level, event: string, fields: Record<string, unknown> = {}) =>
    write(level, { event, ...fields }),
  debug: (event: string, fields?: Record<string, unknown>) => write('debug', { event, ...fields }),
  info: (event: string, fields?: Record<string, unknown>) => write('info', { event, ...fields }),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', { event, ...fields }),
  error: (event: string, fields?: Record<string, unknown> & { error?: unknown }) => {
    const { error, ...rest } = fields ?? {};
    write('error', { event, ...rest, ...(error !== undefined ? { error: serializeError(error) } : {}) });
  },
  forRequest: (req: Request) => ({
    debug: (event: string, fields?: Record<string, unknown>) =>
      logger.debug(event, { requestId: req.context?.requestId, ...fields }),
    info: (event: string, fields?: Record<string, unknown>) =>
      logger.info(event, { requestId: req.context?.requestId, ...fields }),
    warn: (event: string, fields?: Record<string, unknown>) =>
      logger.warn(event, { requestId: req.context?.requestId, ...fields }),
    error: (event: string, fields?: Record<string, unknown> & { error?: unknown }) =>
      logger.error(event, { requestId: req.context?.requestId, ...fields }),
  }),
};

/** Assigns a requestId (honouring an inbound x-request-id header) and echoes it back. */
export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const inbound = req.header('x-request-id');
  const requestId = inbound && inbound.length <= 128 ? inbound : randomUUID();
  req.context = { requestId };
  res.setHeader('x-request-id', requestId);
  next();
};
