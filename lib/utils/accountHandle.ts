export const parseAccountHandle = (value: string) => {
  const normalized = value.trim().replace(/^@/, '').toLowerCase()
  const [username, domain, ...rest] = normalized.split('@')
  if (!username || !domain || rest.length > 0) return null
  return { username, domain }
}
