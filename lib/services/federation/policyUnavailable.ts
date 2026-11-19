// Federation policy could not be decided: the stored settings were unreadable
// with nothing cached, so a database-only allowlist may be in force. Thrown
// instead of answering "no", which outbound jobs treat as a finished skip;
// queues retry it, an inbound request answers 5xx so the sender retries, and
// a redirect policy refuses the hop.
export class FederationPolicyUnavailableError extends Error {
  constructor() {
    super('Federation policy is unavailable: server settings could not be read')
    this.name = 'FederationPolicyUnavailableError'
  }
}

// For a catch that would otherwise turn every error into a skip or a null.
export const rethrowIfFederationPolicyUnavailable = (error: unknown) => {
  if (error instanceof FederationPolicyUnavailableError) throw error
}
