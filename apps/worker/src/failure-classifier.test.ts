import { describe, it, expect } from 'vitest';
import { classifyFailure } from './failure-classifier.js';

describe('classifyFailure', () => {
  it('should classify timeout errors', () => {
    expect(classifyFailure(new Error('Request timeout'))).toBe('timeout');
    expect(classifyFailure(new Error('Connection timed out'))).toBe('timeout');
  });

  it('should classify transient network errors', () => {
    expect(classifyFailure(new Error('ECONNREFUSED'))).toBe('transient');
    expect(classifyFailure(new Error('ENOTFOUND'))).toBe('transient');
    expect(classifyFailure(new Error('Connection reset'))).toBe('transient');
  });

  it('should classify validation errors', () => {
    expect(classifyFailure(new Error('Validation failed'))).toBe('validation');
    expect(classifyFailure(new Error('Invalid input'))).toBe('validation');
  });

  it('should classify permanent errors', () => {
    expect(classifyFailure(new Error('Permanent failure'))).toBe('permanent');
    expect(classifyFailure(new Error('Not allowed'))).toBe('permanent');
  });

  it('should classify unknown errors by default', () => {
    expect(classifyFailure(new Error('Something went wrong'))).toBe('unknown');
    expect(classifyFailure('not an error')).toBe('unknown');
  });
});
