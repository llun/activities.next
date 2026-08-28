import {
  canCreateSessionForAccount,
  isAccountConfirmationPending
} from './canCreateSessionForAccount'

describe('isAccountConfirmationPending', () => {
  it.each([
    {
      description: 'reports a registration that has not been confirmed',
      account: { verificationCode: 'pending-code' },
      expected: true
    },
    {
      description:
        'reports a confirmed registration, whose code verifyAccount clears to an empty string',
      account: { verificationCode: '' },
      expected: false
    },
    {
      description:
        'reports an instance with no e-mail configured, which never sets a code',
      account: { verificationCode: null },
      expected: false
    },
    {
      description:
        'ignores verifiedAt, which the column default fills in even for a pending account',
      account: { verificationCode: 'pending-code', verifiedAt: 1 },
      expected: true
    }
  ])('$description', ({ account, expected }) => {
    expect(isAccountConfirmationPending(account)).toBe(expected)
  })
})

describe('canCreateSessionForAccount', () => {
  it.each([
    {
      description: 'rejects an unverified account',
      account: { verifiedAt: null, approvedAt: 1, disabledAt: null },
      expected: false
    },
    {
      description: 'rejects an account still awaiting e-mail confirmation',
      account: {
        verificationCode: 'pending-code',
        verifiedAt: 1,
        approvedAt: 1,
        disabledAt: null
      },
      expected: false
    },
    {
      description: 'rejects a disabled account',
      account: { verifiedAt: 1, approvedAt: 1, disabledAt: 1 },
      expected: false
    },
    {
      description: 'rejects a registration-pending account',
      account: { verifiedAt: 1, approvedAt: null, disabledAt: null },
      expected: false
    },
    {
      description: 'allows a verified, approved, enabled account',
      account: { verifiedAt: 1, approvedAt: 1, disabledAt: null },
      expected: true
    }
  ])('$description', ({ account, expected }) => {
    expect(canCreateSessionForAccount(account)).toBe(expected)
  })
})
