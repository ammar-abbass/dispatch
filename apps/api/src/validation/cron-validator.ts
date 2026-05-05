import { DispatchError } from '@dispatch/shared';

/**
 * Validates a cron expression and rejects sub-minute schedules.
 * Supports standard 5-field cron (minute hour day month dow).
 */
export function validateCron(cron: string): void {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new DispatchError(
      'VALIDATION_ERROR',
      'Cron expression must have exactly 5 fields (minute hour day month dow)',
      400,
    );
  }

  const [minute] = parts;

  // Reject wildcards in minute field that would cause sub-minute execution
  if (minute === '*') {
    throw new DispatchError(
      'VALIDATION_ERROR',
      'Sub-minute cron schedules are not allowed. Minute field must be specific.',
      400,
    );
  }

  if (minute && minute.startsWith('*/') && minute !== '*/1') {
    const step = Number.parseInt(minute.replace('*/', ''), 10);
    if (Number.isNaN(step) || step < 1) {
      throw new DispatchError('VALIDATION_ERROR', 'Invalid cron minute step value', 400);
    }
  }
}
