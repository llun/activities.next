import { formatAccountCreatedAt, formatAccountRole } from './accountDetails'

describe('formatAccountCreatedAt', () => {
  const createdAt = Date.UTC(2026, 0, 12, 10, 30, 45)

  it('formats the date and time without seconds', () => {
    expect(formatAccountCreatedAt(createdAt, 'UTC')).toBe(
      'Jan 12, 2026, 10:30 AM'
    )
  })

  it('uses 12-hour time with an AM/PM marker', () => {
    expect(
      formatAccountCreatedAt(Date.UTC(2026, 9, 2, 12, 23, 10), 'UTC')
    ).toBe('Oct 2, 2026, 12:23 PM')
    expect(formatAccountCreatedAt(Date.UTC(2026, 9, 2, 0, 5, 0), 'UTC')).toBe(
      'Oct 2, 2026, 12:05 AM'
    )
  })

  it('renders the time in the given time zone', () => {
    expect(formatAccountCreatedAt(createdAt, 'Asia/Bangkok')).toBe(
      'Jan 12, 2026, 5:30 PM'
    )
  })
})

describe('formatAccountRole', () => {
  it('capitalises the stored role', () => {
    expect(formatAccountRole('admin')).toBe('Admin')
    expect(formatAccountRole('user')).toBe('User')
  })

  it('falls back to User when there is no role', () => {
    expect(formatAccountRole(undefined)).toBe('User')
    expect(formatAccountRole(null)).toBe('User')
    expect(formatAccountRole('')).toBe('User')
  })
})
