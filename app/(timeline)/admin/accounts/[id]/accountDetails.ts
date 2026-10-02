// "Jan 12, 2026, 10:30 AM": the account's created time without seconds, in the
// design's en-US shape. It is a plain string computed on the server from epoch
// ms — never a Date prop (see "Date Serialization in Server Components").
const CREATED_AT_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short'
}

export const formatAccountCreatedAt = (
  createdAt: number,
  timeZone?: string
): string =>
  new Date(createdAt).toLocaleString('en-US', {
    ...CREATED_AT_FORMAT,
    timeZone
  })

// "Admin" / "User": the stored role is a lowercase key ("admin"), the details
// list shows it as a label. An account without a role is a regular user.
export const formatAccountRole = (role?: string | null): string => {
  const value = role?.trim()
  if (!value) return 'User'
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}
