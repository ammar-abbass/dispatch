export type FailureType = 'validation' | 'transient' | 'timeout' | 'permanent' | 'unknown';

export function classifyFailure(error: unknown): FailureType {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('connection'))
      return 'transient';
    if (msg.includes('validation') || msg.includes('invalid') || msg.includes('bad request'))
      return 'validation';
    if (msg.includes('permanent') || msg.includes('not allowed') || msg.includes('forbidden'))
      return 'permanent';
  }
  return 'unknown';
}
