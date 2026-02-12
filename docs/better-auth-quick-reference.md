# Better Auth Schema Changes - Quick Reference

## TL;DR

Run this migration to add Better Auth support:

```bash
yarn migrate
```

This adds required fields WITHOUT breaking existing code.

## What Gets Added

### accounts table
```sql
ALTER TABLE accounts ADD COLUMN name VARCHAR NULL;
ALTER TABLE accounts ADD COLUMN image VARCHAR NULL;
```

### sessions table
```sql
ALTER TABLE sessions ADD COLUMN ipAddress VARCHAR NULL;
ALTER TABLE sessions ADD COLUMN userAgent VARCHAR NULL;
```

### accountProviders table
```sql
ALTER TABLE accountProviders ADD COLUMN accessToken TEXT NULL;
ALTER TABLE accountProviders ADD COLUMN refreshToken TEXT NULL;
ALTER TABLE accountProviders ADD COLUMN accessTokenExpiresAt TIMESTAMP NULL;
ALTER TABLE accountProviders ADD COLUMN refreshTokenExpiresAt TIMESTAMP NULL;
ALTER TABLE accountProviders ADD COLUMN idToken TEXT NULL;
ALTER TABLE accountProviders ADD COLUMN scope VARCHAR NULL;
ALTER TABLE accountProviders ADD COLUMN password TEXT NULL;
```

### NEW: verification table
```sql
CREATE TABLE verification (
  id VARCHAR PRIMARY KEY,
  identifier VARCHAR NOT NULL,
  value VARCHAR NOT NULL,
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
```

## Field Mapping Guide

Since we're NOT renaming existing columns, the adapter needs to map:

| Current Schema | Better Auth Expects | Adapter Mapping |
|----------------|---------------------|-----------------|
| `accounts.passwordHash` | `account.password` | Keep passwordHash, handle in adapter |
| `accounts.emailVerifiedAt` | `user.emailVerified` | Convert timestamp to boolean |
| `sessions.accountId` | `session.userId` | Map accountId → userId |
| `sessions.expireAt` | `session.expiresAt` | Map expireAt → expiresAt |
| `accountProviders.accountId` | `account.userId` | Map accountId → userId |
| `accountProviders.provider` | `account.providerId` | Map provider → providerId |
| `accountProviders.providerId` | `account.accountId` | Map providerId → accountId |

## Example Adapter Mapping

```typescript
// When Better Auth wants to find a user by email
async findOne({ model: 'user', where: [{ field: 'email', value: 'user@example.com' }] }) {
  const account = await db('accounts').where('email', 'user@example.com').first()
  
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    image: account.image,
    emailVerified: !!account.emailVerifiedAt,  // Convert timestamp to boolean
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }
}

// When Better Auth wants to create a session
async create({ model: 'session', data }) {
  await db('sessions').insert({
    id: data.id,
    accountId: data.userId,      // Map userId → accountId
    token: data.token,
    expireAt: data.expiresAt,    // Map expiresAt → expireAt
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    actorId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  })
}
```

## Why This Approach?

✅ **Non-breaking**: Existing code continues working
✅ **Safe**: Only adds columns, never deletes
✅ **Reversible**: Easy to rollback
✅ **Preserves custom fields**: actorId, passwordHash, etc. stay intact

## What's NOT Changed

❌ No table renames
❌ No column renames  
❌ No data deletion
❌ No breaking changes to existing code

## Visual Schema Diff

### BEFORE (Current)
```
accounts
├─ id (PK)
├─ email (unique)
├─ passwordHash
├─ verifiedAt
├─ emailVerifiedAt
├─ ...other fields...

sessions
├─ id (PK)
├─ accountId (FK)
├─ token
├─ expireAt
├─ actorId
├─ createdAt
├─ updatedAt

accountProviders
├─ id (PK)
├─ accountId (FK)
├─ provider
├─ providerId
├─ createdAt
├─ updatedAt
```

### AFTER (With Better Auth Fields)
```
accounts
├─ id (PK)
├─ email (unique)
├─ passwordHash
├─ verifiedAt
├─ emailVerifiedAt
├─ name ← NEW
├─ image ← NEW
├─ ...other fields...

sessions
├─ id (PK)
├─ accountId (FK)
├─ token
├─ expireAt
├─ actorId
├─ ipAddress ← NEW
├─ userAgent ← NEW
├─ createdAt
├─ updatedAt

accountProviders
├─ id (PK)
├─ accountId (FK)
├─ provider
├─ providerId
├─ accessToken ← NEW
├─ refreshToken ← NEW
├─ accessTokenExpiresAt ← NEW
├─ refreshTokenExpiresAt ← NEW
├─ idToken ← NEW
├─ scope ← NEW
├─ password ← NEW
├─ createdAt
├─ updatedAt

verification ← NEW TABLE
├─ id (PK)
├─ identifier
├─ value
├─ expiresAt
├─ createdAt
├─ updatedAt
```

## Testing After Migration

```bash
# Check accounts have names
SELECT COUNT(*) FROM accounts WHERE name IS NULL;
# Should return 0

# Check verification table exists
SELECT COUNT(*) FROM verification;
# Should return count of migrated codes

# Check sessions intact
SELECT COUNT(*) FROM sessions;
# Should match pre-migration count

# Check account providers intact
SELECT COUNT(*) FROM accountProviders;
# Should match pre-migration count
```

## Full Documentation

See `docs/better-auth-schema-migration.md` for:
- Complete field mapping details
- Full adapter implementation examples
- Alternative migration strategies
- Troubleshooting guide
- Testing procedures

## Questions?

1. **Do I need to rename columns?** No! The adapter handles mapping.
2. **Will existing auth still work?** Yes! This is additive only.
3. **Can I rollback?** Yes! Run `yarn knex migrate:rollback`
4. **What about my custom fields?** They're preserved (actorId, passwordHash, etc.)
5. **Do I need to update app code?** Not for the schema migration. Only when you switch from NextAuth APIs to Better Auth APIs.
