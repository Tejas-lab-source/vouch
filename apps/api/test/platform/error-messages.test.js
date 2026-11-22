// @ts-check
import { AppErrorCode } from '@vouch/contracts';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors.js';

describe('readable error messages', () => {
  it('every AppErrorCode has a readable message that is not just the code', () => {
    const missing = AppErrorCode.options.filter((code) => {
      const { message } = new AppError(code);
      return !message || message === code || /^[A-Z_]+$/.test(message) || message.length < 8;
    });
    expect(missing).toEqual([]);
  });
});
