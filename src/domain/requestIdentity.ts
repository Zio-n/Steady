export type IdempotentRequest = { signature: string; requestId: string };

/** Reuse the request ID only while the submitted payload is unchanged. */
export function nextIdempotentRequest(
  previous: IdempotentRequest | null,
  payload: unknown,
  createId: () => string,
): IdempotentRequest {
  const signature = JSON.stringify(payload);
  return previous?.signature === signature ? previous : { signature, requestId: createId() };
}
