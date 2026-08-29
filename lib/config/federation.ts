export const isInboxForwardingEnabled = (): boolean =>
  process.env.ACTIVITIES_ENABLE_INBOX_FORWARDING === 'true'
