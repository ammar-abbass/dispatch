export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'CONFLICT_ERROR'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class DispatchError extends Error {
  public readonly meta: Record<string, unknown> | undefined;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode = 500,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DispatchError';
    this.meta = meta;
  }
}
