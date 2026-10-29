export class AppError extends Error {
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    options?: { publicMessage?: string; details?: Record<string, unknown>; cause?: unknown }
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.publicMessage = options?.publicMessage ?? message;
    this.details = options?.details;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message, 400, { publicMessage: message, details, cause });
  }
}

export class BodyParseError extends ValidationError {
  constructor(cause?: unknown) {
    super('Malformed request body', undefined, cause);
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', cause?: unknown) {
    super(message, 401, { publicMessage: 'Unauthorized', cause });
  }
}

export class StateConflictError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 409, { publicMessage: message, cause });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', cause?: unknown) {
    super(message, 404, { publicMessage: message, cause });
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;

/** Returns true for errors produced by express.json()/urlencoded() body parsing. */
export const isBodyParseError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const e = err as { type?: string; status?: number; statusCode?: number };
  return (
    e.type === 'entity.parse.failed' ||
    e.type === 'encoding.unsupported' ||
    e.type === 'charset.unsupported' ||
    e.type === 'entity.too.large' ||
    ((e.status === 400 || e.statusCode === 400) && e.type?.startsWith('entity.') === true)
  );
}
