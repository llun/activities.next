# Better Auth Schema Migration Guide

## Executive Summary

This document details the database schema changes required to migrate from NextAuth to Better Auth while maintaining the existing ActivityPub functionality.

## Current vs. Better Auth Schema Comparison

### Table: `accounts` → Better Auth: `user`

| Current Column | Type | Better Auth Equivalent | Type | Migration Action |
|---|---|---|---|---|
| `id` | string (PK) | `id` | string (PK) | ✅ Keep as-is |
| `email` | string (unique) | `email` | string (unique) | ✅ Keep as-is |
| `passwordHash` | string | `password` (in account table) | string | 🔄 Handle via adapter |
| `verifiedAt` | timestamp | - | - | 🔄 Custom field, keep |
| `emailVerifiedAt` | timestamp | `emailVerified` | boolean | 🔄 Keep timestamp, derive boolean |
| `emailChangePending` | string | - | - | 🔄 Custom field, keep |
| `emailChangeCode` | string | - | - | 🔄 Custom field, keep |
| `emailChangeCodeExpiresAt` | timestamp | - | - | 🔄 Custom field, keep |
| `passwordResetCode` | string | (in verification table) | - | 🔄 Migrate to verification |
| `passwordResetCodeExpiresAt` | timestamp | (in verification table) | - | 🔄 Migrate to verification |
| `defaultActorId` | string | - | - | 🔄 Custom field, keep |
| `verificationCode` | string | (in verification table) | - | 🔄 Migrate to verification |
| `createdAt` | timestamp | `createdAt` | date | ✅ Keep as-is |
| `updatedAt` | timestamp | `updatedAt` | date | ✅ Keep as-is |
| - | - | `name` | string | ➕ **ADD** required field |
| - | - | `image` | string (optional) | ➕ **ADD** optional field |

### Table: `sessions` → Better Auth: `session`

| Current Column | Type | Better Auth Equivalent | Type | Migration Action |
|---|---|---|---|---|
| `id` | string (PK) | `id` | string (PK) | ✅ Keep as-is |
| `accountId` | string (FK) | `userId` | string (FK) | 🔄 Rename OR map in adapter |
| `token` | string (unique) | `token` | string (unique) | ✅ Keep as-is |
| `expireAt` | timestamp | `expiresAt` | date | 🔄 Rename OR map in adapter |
| `actorId` | string (nullable) | - | - | 🔄 Custom field, keep for ActivityPub |
| `createdAt` | timestamp | `createdAt` | date | ✅ Keep as-is |
| `updatedAt` | timestamp | `updatedAt` | date | ✅ Keep as-is |
| - | - | `ipAddress` | string | ➕ **ADD** optional field |
| - | - | `userAgent` | string | ➕ **ADD** optional field |

### Table: `accountProviders` → Better Auth: `account`

| Current Column | Type | Better Auth Equivalent | Type | Migration Action |
|---|---|---|---|---|
| `id` | string (PK) | `id` | string (PK) | ✅ Keep as-is |
| `accountId` | string (FK) | `userId` | string (FK) | 🔄 Rename OR map in adapter |
| `provider` | string | `providerId` | string | 🔄 Rename OR map in adapter |
| `providerId` | string | `accountId` | string | 🔄 Rename OR map in adapter |
| `createdAt` | timestamp | `createdAt` | date | ✅ Keep as-is |
| `updatedAt` | timestamp | `updatedAt` | date | ✅ Keep as-is |
| - | - | `accessToken` | string (optional) | ➕ **ADD** for OAuth |
| - | - | `refreshToken` | string (optional) | ➕ **ADD** for OAuth |
| - | - | `accessTokenExpiresAt` | date (optional) | ➕ **ADD** for OAuth |
| - | - | `refreshTokenExpiresAt` | date (optional) | ➕ **ADD** for OAuth |
| - | - | `idToken` | string (optional) | ➕ **ADD** for OAuth |
| - | - | `scope` | string (optional) | ➕ **ADD** for OAuth |
| - | - | `password` | string (optional) | ➕ **ADD** if using credentials in account table |

### New Table: `verification` (Better Auth requirement)

| Column | Type | Purpose |
|---|---|---|
| `id` | string (PK) | Unique identifier |
| `identifier` | string | Email or phone being verified |
| `value` | string | Verification token |
| `expiresAt` | date | Token expiration |
| `createdAt` | date | Creation timestamp |
| `updatedAt` | date | Last update timestamp |

**Migration Note:** Move `accounts.verificationCode` and `accounts.passwordResetCode` to this table.

## Migration Strategies

### Strategy 1: Column Renaming (Most Invasive)

**Pros:**
- Schema matches Better Auth expectations exactly
- Cleaner adapter code

**Cons:**
- Breaking changes to all application code
- All queries need updating
- Risky migration
- Downtime required

**Required Renames:**
```sql
-- sessions table
ALTER TABLE sessions RENAME COLUMN accountId TO userId;
ALTER TABLE sessions RENAME COLUMN expireAt TO expiresAt;

-- accountProviders table (confusing names!)
ALTER TABLE accountProviders RENAME COLUMN accountId TO userId;
ALTER TABLE accountProviders RENAME COLUMN provider TO providerId;
ALTER TABLE accountProviders RENAME COLUMN providerId TO accountId;
```

### Strategy 2: Field Mapping via Adapter (Recommended)

**Pros:**
- No breaking changes to application code
- Gradual migration possible
- Lower risk
- No downtime

**Cons:**
- Adapter code complexity
- Field name confusion persists

**Implementation:**
```typescript
// Custom adapter maps between schemas
const adapter = {
  async create({ model, data }) {
    if (model === 'session') {
      return await db('sessions').insert({
        id: data.id,
        accountId: data.userId,  // Map userId → accountId
        token: data.token,
        expireAt: data.expiresAt, // Map expiresAt → expireAt
        // ...
      })
    }
  },
  async findOne({ model, where }) {
    if (model === 'session') {
      const result = await db('sessions')
        .where('token', where.token)
        .first()
      
      return {
        id: result.id,
        userId: result.accountId,  // Map accountId → userId
        token: result.token,
        expiresAt: result.expireAt, // Map expireAt → expiresAt
        // ...
      }
    }
  }
  // ... more CRUD operations
}
```

### Strategy 3: Hybrid Approach (Best Balance)

**Phase 1: Add Missing Columns (Non-Breaking)**
```javascript
// Migration 1: Add Better Auth fields
exports.up = function(knex) {
  return knex.schema
    .alterTable('accounts', function(table) {
      table.string('name').nullable()
      table.string('image').nullable()
    })
    .alterTable('sessions', function(table) {
      table.string('ipAddress').nullable()
      table.string('userAgent').nullable()
    })
    .alterTable('accountProviders', function(table) {
      table.string('accessToken').nullable()
      table.string('refreshToken').nullable()
      table.timestamp('accessTokenExpiresAt', { useTz: true }).nullable()
      table.timestamp('refreshTokenExpiresAt', { useTz: true }).nullable()
      table.string('idToken').nullable()
      table.string('scope').nullable()
      table.string('password').nullable()
    })
    .createTable('verification', function(table) {
      table.string('id').primary()
      table.string('identifier')
      table.string('value')
      table.timestamp('expiresAt', { useTz: true })
      table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
      table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
      table.index(['identifier', 'value'], 'verificationIndex')
    })
}
```

**Phase 2: Use Field Mapping Adapter**
- Map `accountId` ↔ `userId`
- Map `expireAt` ↔ `expiresAt`
- Map `provider`/`providerId` to Better Auth's naming

**Phase 3: Migrate Data** (optional future step)
- Populate `name` from actors table
- Migrate verification codes to verification table
- Remove deprecated columns once confirmed stable

## Detailed Migration Steps

### Step 1: Create Migration File

```bash
yarn migrate:make add_better_auth_fields
```

### Step 2: Implement Migration (Hybrid Approach)

```javascript
// migrations/YYYYMMDDHHMMSS_add_better_auth_fields.js

exports.up = async function(knex) {
  // Add fields to accounts table
  await knex.schema.alterTable('accounts', function(table) {
    table.string('name').nullable()
    table.string('image').nullable()
  })
  
  // Add fields to sessions table
  await knex.schema.alterTable('sessions', function(table) {
    table.string('ipAddress').nullable()
    table.string('userAgent').nullable()
  })
  
  // Add OAuth fields to accountProviders table
  await knex.schema.alterTable('accountProviders', function(table) {
    table.string('accessToken').nullable()
    table.string('refreshToken').nullable()
    table.timestamp('accessTokenExpiresAt', { useTz: true }).nullable()
    table.timestamp('refreshTokenExpiresAt', { useTz: true }).nullable()
    table.string('idToken').nullable()
    table.string('scope').nullable()
    table.string('password').nullable()
  })
  
  // Create verification table
  await knex.schema.createTable('verification', function(table) {
    table.string('id').primary()
    table.string('identifier')
    table.string('value')
    table.timestamp('expiresAt', { useTz: true })
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())
    
    table.index(['identifier', 'value'], 'verificationIndex')
  })
  
  // Populate name field from actors if empty
  await knex.raw(`
    UPDATE accounts 
    SET name = COALESCE(
      (SELECT actors.name 
       FROM actors 
       WHERE actors.accountId = accounts.id 
       LIMIT 1),
      accounts.email
    )
    WHERE name IS NULL
  `)
  
  // Migrate existing verification codes to verification table
  const accountsWithCodes = await knex('accounts')
    .select('id', 'email', 'verificationCode', 'createdAt', 'updatedAt')
    .whereNotNull('verificationCode')
  
  for (const account of accountsWithCodes) {
    await knex('verification').insert({
      id: crypto.randomUUID(),
      identifier: account.email,
      value: account.verificationCode,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    })
  }
}

exports.down = async function(knex) {
  await knex.schema.dropTable('verification')
  
  await knex.schema.alterTable('accountProviders', function(table) {
    table.dropColumn('password')
    table.dropColumn('scope')
    table.dropColumn('idToken')
    table.dropColumn('refreshTokenExpiresAt')
    table.dropColumn('accessTokenExpiresAt')
    table.dropColumn('refreshToken')
    table.dropColumn('accessToken')
  })
  
  await knex.schema.alterTable('sessions', function(table) {
    table.dropColumn('userAgent')
    table.dropColumn('ipAddress')
  })
  
  await knex.schema.alterTable('accounts', function(table) {
    table.dropColumn('image')
    table.dropColumn('name')
  })
}
```

### Step 3: Run Migration

```bash
yarn migrate
```

### Step 4: Update Custom Adapter

Update `lib/auth/adapter.ts` to properly map between schemas:

```typescript
import { Adapter } from 'better-auth'
import bcrypt from 'bcrypt'
import { getDatabase } from '@/lib/database'

export function databaseAdapter(): Adapter {
  return {
    id: 'activities-custom-adapter',
    
    async create({ model, data }) {
      const database = getDatabase()
      if (!database) throw new Error('Database not available')

      if (model === 'user') {
        // Map to accounts table
        const accountId = crypto.randomUUID()
        const currentTime = Date.now()
        
        await database.query('accounts').insert({
          id: accountId,
          email: data.email,
          name: data.name || data.email,
          image: data.image || null,
          passwordHash: data.password ? await bcrypt.hash(data.password, 10) : null,
          emailVerifiedAt: data.emailVerified ? currentTime : null,
          verifiedAt: data.emailVerified ? currentTime : null,
          createdAt: currentTime,
          updatedAt: currentTime
        })

        return {
          id: accountId,
          email: data.email,
          name: data.name || data.email,
          image: data.image || null,
          emailVerified: !!data.emailVerified,
          createdAt: new Date(currentTime),
          updatedAt: new Date(currentTime)
        }
      }

      if (model === 'session') {
        // Map to sessions table
        const sessionId = crypto.randomUUID()
        const currentTime = Date.now()

        await database.query('sessions').insert({
          id: sessionId,
          accountId: data.userId,  // Map userId → accountId
          token: data.token,
          expireAt: data.expiresAt instanceof Date ? data.expiresAt.getTime() : data.expiresAt, // Map expiresAt → expireAt
          ipAddress: data.ipAddress || null,
          userAgent: data.userAgent || null,
          actorId: null,
          createdAt: currentTime,
          updatedAt: currentTime
        })

        return {
          id: sessionId,
          userId: data.userId,
          token: data.token,
          expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(data.expiresAt),
          ipAddress: data.ipAddress || null,
          userAgent: data.userAgent || null,
          createdAt: new Date(currentTime),
          updatedAt: new Date(currentTime)
        }
      }

      if (model === 'account') {
        // Map to accountProviders table
        await database.query('accountProviders').insert({
          id: crypto.randomUUID(),
          accountId: data.userId,  // Map userId → accountId
          provider: data.providerId,  // Map providerId → provider
          providerId: data.accountId, // Map accountId → providerId
          accessToken: data.accessToken || null,
          refreshToken: data.refreshToken || null,
          accessTokenExpiresAt: data.accessTokenExpiresAt || null,
          refreshTokenExpiresAt: data.refreshTokenExpiresAt || null,
          idToken: data.idToken || null,
          scope: data.scope || null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })

        return {
          id: crypto.randomUUID(),
          userId: data.userId,
          providerId: data.providerId,
          accountId: data.accountId,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      }

      throw new Error(`Unsupported model: ${model}`)
    },

    async findOne({ model, where }) {
      const database = getDatabase()
      if (!database) return null

      if (model === 'user') {
        // Find in accounts table
        const emailCondition = where.find((w: any) => w.field === 'email')
        const idCondition = where.find((w: any) => w.field === 'id')

        let account
        if (emailCondition) {
          account = await database.getActorFromEmail({ email: emailCondition.value as string })
          account = account?.account
        } else if (idCondition) {
          account = await database.getAccountFromId({ id: idCondition.value as string })
        }

        if (!account) return null

        return {
          id: account.id,
          email: account.email,
          name: account.name || account.email,
          image: account.image || null,
          emailVerified: !!account.emailVerifiedAt,
          createdAt: new Date(account.createdAt),
          updatedAt: new Date(account.updatedAt)
        }
      }

      if (model === 'session') {
        // Find in sessions table
        const tokenCondition = where.find((w: any) => w.field === 'token')
        if (tokenCondition) {
          const result = await database.getAccountSession({ token: tokenCondition.value as string })
          if (!result) return null

          return {
            id: result.session.id,
            userId: result.session.accountId,  // Map accountId → userId
            token: result.session.token,
            expiresAt: new Date(result.session.expireAt),  // Map expireAt → expiresAt
            ipAddress: result.session.ipAddress || null,
            userAgent: result.session.userAgent || null,
            createdAt: new Date(result.session.createdAt),
            updatedAt: new Date(result.session.updatedAt)
          }
        }
      }

      if (model === 'account') {
        // Find in accountProviders table
        const providerCondition = where.find((w: any) => w.field === 'providerId')
        const accountCondition = where.find((w: any) => w.field === 'accountId')
        
        if (providerCondition && accountCondition) {
          const result = await database.getAccountFromProviderId({
            provider: providerCondition.value as string,  // Map providerId → provider
            accountId: accountCondition.value as string    // Map accountId → providerId
          })
          
          if (!result) return null
          
          // Return in Better Auth format
          return {
            id: result.id,
            userId: result.accountId,       // Map accountId → userId
            providerId: result.provider,    // Map provider → providerId
            accountId: result.providerId,   // Map providerId → accountId
            createdAt: new Date(result.createdAt),
            updatedAt: new Date(result.updatedAt)
          }
        }
      }

      return null
    },

    // ... implement findMany, update, delete similarly
  }
}
```

## Testing the Migration

### 1. Test on Development Database

```bash
# Backup database first
pg_dump activities_next > backup.sql  # PostgreSQL
# or
cp data/database.sqlite3 data/database.sqlite3.backup  # SQLite

# Run migration
yarn migrate

# Verify tables
psql activities_next -c "\d accounts"  # PostgreSQL
# or
sqlite3 data/database.sqlite3 ".schema accounts"  # SQLite
```

### 2. Test Data Integrity

```sql
-- Verify name field populated
SELECT id, email, name FROM accounts WHERE name IS NULL;

-- Verify verification codes migrated
SELECT COUNT(*) FROM verification;

-- Verify sessions intact
SELECT COUNT(*) FROM sessions;

-- Verify account providers intact
SELECT COUNT(*) FROM accountProviders;
```

### 3. Test Authentication Flows

1. Sign in with credentials
2. Sign in with GitHub OAuth
3. Create new account
4. Password reset flow
5. Email verification flow

## Rollback Plan

If issues occur:

```bash
# Rollback migration
yarn knex migrate:rollback

# Restore from backup
psql activities_next < backup.sql  # PostgreSQL
# or
cp data/database.sqlite3.backup data/database.sqlite3  # SQLite
```

## Summary

**Recommended Approach: Hybrid Strategy**

1. ✅ Add new columns (non-breaking)
2. ✅ Create verification table
3. ✅ Populate name from actors
4. ✅ Migrate verification codes
5. ✅ Use field mapping in adapter
6. ✅ Keep existing column names
7. ✅ Preserve custom fields (actorId, passwordHash)

This provides the safest migration path with minimal risk and maintains backward compatibility with the ActivityPub implementation.
