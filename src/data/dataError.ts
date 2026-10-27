import type { PostgrestError } from '@supabase/supabase-js';

export type DataErrorKind = 'configuration' | 'permission' | 'conflict' | 'validation' | 'not-found' | 'network' | 'unknown';

export class DataError extends Error {
  readonly kind: DataErrorKind;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, kind: DataErrorKind, code?: string, retryable = false) {
    super(message);
    this.name = 'DataError';
    this.kind = kind;
    this.code = code;
    this.retryable = retryable;
  }
}

export function toDataError(error: PostgrestError | Error): DataError {
  const code = 'code' in error ? error.code : undefined;
  const message = error.message || 'The request could not be completed.';
  if (code === '42501' || code === '28000') return new DataError('You do not have access to this information. Please sign in again.', 'permission', code);
  if (code === '40001' || code === '23505' || code === '23503') return new DataError('This information changed elsewhere. Refresh and review your changes.', 'conflict', code);
  if (code === '22023' || code === '23514' || code === '22P02') return new DataError('Some information is invalid. Review the fields and try again.', 'validation', code);
  if (code === 'PGRST116') return new DataError('That item is no longer available.', 'not-found', code);
  if (!code && /fetch|network|timeout/i.test(message)) return new DataError('Could not reach Steady. Check your connection; the save has not been confirmed.', 'network', undefined, true);
  return new DataError('Steady could not complete that request. Please try again.', 'unknown', code, true);
}
