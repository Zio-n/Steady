type LocalAuth = {
  signOut(options: { scope: 'local' }): Promise<{ error: Error | null }>;
  getSession(): Promise<{ data: { session: unknown | null }; error: Error | null }>;
};

/** Clear this device's session even when the remote logout cannot be confirmed. */
export async function signOutLocal(auth: LocalAuth) {
  let failure: unknown;
  try {
    const { error } = await auth.signOut({ scope: 'local' });
    if (!error) return;
    failure = error;
  } catch (error) {
    failure = error;
  }

  // Current auth-js clears the local session on retryable logout failures.
  // Check that state, not only the network response, before reporting failure.
  try {
    const { data, error } = await auth.getSession();
    if (!error && data.session === null) return;
  } catch {
    // The original logout failure is the useful error to report.
  }
  throw failure;
}
