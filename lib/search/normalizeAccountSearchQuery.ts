export const normalizeAccountSearchQuery = (query: string) =>
  query
    .trim()
    .replace(/^acct:/i, '')
    .replace(/^@/, '')
