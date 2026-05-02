import { describe, it, expect } from 'vitest';
import { ok, err, type Result } from './result.js';

describe('Result type', () => {
  it('should create an Ok result', () => {
    const r: Result<number, string> = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('should create an Err result', () => {
    const r: Result<number, string> = err('fail');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('fail');
  });
});
