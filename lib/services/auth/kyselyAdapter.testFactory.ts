// What the adapter unit suites put in place of better-auth's
// `createAdapterFactory` (`vi.mock('better-auth/adapters', …)` imports this),
// so they test the adapter's own SQL rather than the factory's transforms.
// Kept free of imports: it is loaded while `better-auth/adapters` is being
// mocked.

// Mirrors the schema better-auth hands the adapter: keyed by model name, with
// the table under `modelName` and each field's column under `fieldName` (here
// the field name is the column, matching the identity helpers below) and its
// better-auth `type`. The adapter reads it to learn which columns a joined
// table contributes and which columns hold dates.
//
// `accounts` is deliberately absent so the join tests can also exercise the
// path for a table the schema does not describe.
export const testSchema = {
  users: {
    modelName: 'users',
    fields: {
      display_name: { type: 'string' },
      email: { type: 'string' },
      email_verified: { type: 'boolean' },
      createdAt: { type: 'date' },
      created_at: { type: 'date' },
      updated_at: { type: 'date' }
    }
  },
  sessions: {
    modelName: 'sessions',
    fields: {
      user_id: { type: 'string' },
      accountId: { type: 'string' },
      token: { type: 'string' },
      expires_at: { type: 'date' },
      createdAt: { type: 'date' },
      expireAt: { type: 'date' }
    }
  },
  counters: {
    modelName: 'counters',
    fields: {
      value: { type: 'number' },
      bucketHour: { type: 'date' },
      createdAt: { type: 'date' },
      updatedAt: { type: 'date' }
    }
  },
  // `revoked` is a date without the `At` suffix, like better-auth's
  // `oauthRefreshToken.revoked`; `issuedAt` is a string with it.
  tokens: {
    modelName: 'tokens',
    fields: {
      revoked: { type: 'date' },
      issuedAt: { type: 'string' }
    }
  }
}

type AdapterHelpers = {
  getModelName: (model: string) => string
  getFieldName: (opts: { model: string; field: string }) => string
  schema: unknown
}

// Returns a factory that, when called, invokes the adapter with identity
// getModelName/getFieldName (no field remapping).
export const createAdapterFactory =
  ({
    adapter
  }: {
    config: Record<string, unknown>
    adapter: (
      helpers: AdapterHelpers
    ) => Record<string, (...args: any[]) => any>
  }) =>
  () =>
    adapter({
      getModelName: (model) => model,
      getFieldName: (options) => options.field,
      schema: testSchema
    })
