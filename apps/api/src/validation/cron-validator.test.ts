import { describe, it, expect } from 'vitest';
import { validateCron } from './cron-validator.js';
import { DispatchError } from '@dispatch/shared';

describe('validateCron', () => {
  it('should accept valid cron expressions', () => {
    expect(() => validateCron('0 9 * * *')).not.toThrow();
    expect(() => validateCron('30 14 * * 1')).not.toThrow();
  });

  it('should reject sub-minute wildcards', () => {
    expect(() => validateCron('* * * * *')).toThrow(DispatchError);
    expect(() => validateCron('* 9 * * *')).toThrow(DispatchError);
  });

  it('should reject invalid field counts', () => {
    expect(() => validateCron('0 9 * *')).toThrow(DispatchError);
    expect(() => validateCron('0 9 * * * *')).toThrow(DispatchError);
  });
});
