# Better Auth Migration Guide

## Overview

This guide explains the database schema changes needed to migrate from NextAuth to Better Auth in the activities.next project.

## Quick Start

### TL;DR

```bash
# 1. Backup your database
yarn run backup  # or manually backup

# 2. Run the migration
yarn migrate

# 3. Verify changes
yarn run verify-migration  # or manually verify
```

That's it! The migration is **non-breaking** and adds only the fields Better Auth requires.

## What Changes?

### Summary

The migration **adds** new fields to support Better Auth without removing or renaming existing columns. This ensures backward compatibility.

#### accounts table
- ✅ Adds `name` (user display name)
- ✅ Adds `image` (profile picture)
- ✅ Keeps all existing fields

#### sessions table
- ✅ Adds `ipAddress` (for security tracking)
- ✅ Adds `userAgent` (for device tracking)
- ✅ Keeps `actorId` (custom field for ActivityPub)

#### accountProviders table
- ✅ Adds OAuth token fields (`accessToken`, `refreshToken`, etc.)
- ✅ Keeps existing provider tracking fields

#### NEW: verification table
- ✅ New table for email verification and password reset
- ✅ Migrates existing verification codes automatically

### What Does NOT Change

- ❌ No table renames
- ❌ No column renames
- ❌ No data deletion
- ❌ No breaking changes to existing code

## Documentation

We've provided three levels of documentation:

### 1. Comprehensive Guide (RECOMMENDED)
📄 **[better-auth-schema-migration.md](./better-auth-schema-migration.md)**

**18,500+ characters** covering:
- Complete schema comparison tables
- Three migration strategies
- Full adapter implementation examples
- Step-by-step instructions
- Testing procedures
- Troubleshooting guide

**Best for**: Understanding the complete picture

### 2. Quick Reference
📄 **[better-auth-quick-reference.md](./better-auth-quick-reference.md)**

**5,400+ characters** providing:
- TL;DR summary
- SQL reference for schema changes
- Field mapping cheat sheet
- Quick adapter examples
- FAQ

**Best for**: Quick implementation reference

### 3. Visual Guide
📄 **[better-auth-visual-guide.md](./better-auth-visual-guide.md)**

**15,300+ characters** showing:
- ASCII diagrams of schema transformation
- Before/after comparisons
- Visual flow diagrams
- Timeline of migration steps

**Best for**: Visual learners

## Migration File

📄 **[migrations/20260212000000_add_better_auth_fields.js](../migrations/20260212000000_add_better_auth_fields.js)**

Production-ready migration that:
- Adds all required Better Auth fields
- Creates verification table
- Migrates existing verification codes
- Populates name from actors table
- Includes full rollback support

## Field Mapping

Since we don't rename columns (to avoid breaking changes), the Better Auth adapter needs to map between naming conventions:

| Your Database | Better Auth Expects | How Adapter Handles |
|---------------|---------------------|---------------------|
| `accounts` table | `user` model | Maps in adapter |
| `accounts.passwordHash` | `account.password` | Keeps separate |
| `accounts.emailVerifiedAt` | `user.emailVerified` | Converts timestamp to boolean |
| `sessions.accountId` | `session.userId` | Renames in adapter |
| `sessions.expireAt` | `session.expiresAt` | Renames in adapter |
| `accountProviders.accountId` | `account.userId` | Renames in adapter |
| `accountProviders.provider` | `account.providerId` | Renames in adapter |
| `accountProviders.providerId` | `account.accountId` | Renames in adapter (confusing!) |

## Safety Features

✅ **Non-Destructive**: Only adds columns, never deletes
✅ **Backward Compatible**: Existing code continues working
✅ **Reversible**: Clean rollback available
✅ **Data Preservation**: All existing data intact
✅ **Custom Fields**: ActivityPub fields preserved (actorId, passwordHash, etc.)

## Step-by-Step Instructions

### Before Migration

1. **Backup your database**
   ```bash
   # PostgreSQL
   pg_dump activities_next > backup_$(date +%Y%m%d).sql
   
   # SQLite
   cp data/database.sqlite3 data/database.sqlite3.backup
   ```

2. **Review the migration file**
   ```bash
   cat migrations/20260212000000_add_better_auth_fields.js
   ```

3. **Test on development first**
   - Never run migrations on production without testing
   - Use a copy of production data for testing

### Running Migration

1. **Apply the migration**
   ```bash
   yarn migrate
   ```

2. **Verify success**
   ```bash
   # PostgreSQL
   psql activities_next -c "\d accounts"
   psql activities_next -c "\d sessions"
   psql activities_next -c "\d accountProviders"
   psql activities_next -c "SELECT COUNT(*) FROM verification"
   
   # SQLite
   sqlite3 data/database.sqlite3 ".schema accounts"
   sqlite3 data/database.sqlite3 ".schema sessions"
   sqlite3 data/database.sqlite3 ".schema accountProviders"
   sqlite3 data/database.sqlite3 "SELECT COUNT(*) FROM verification"
   ```

3. **Check data integrity**
   ```sql
   -- All accounts should have names
   SELECT COUNT(*) FROM accounts WHERE name IS NULL;
   -- Should return 0
   
   -- Verification codes should be migrated
   SELECT COUNT(*) FROM verification;
   -- Should show number of migrated codes
   
   -- All sessions should be intact
   SELECT COUNT(*) FROM sessions;
   -- Should match pre-migration count
   ```

### After Migration

1. **Update the adapter** (`lib/auth/adapter.ts`)
   - Implement field mapping logic
   - See comprehensive guide for examples

2. **Configure Better Auth** (`lib/auth/index.ts`)
   - Set up credentials provider
   - Configure OAuth providers
   - Configure session settings

3. **Test authentication flows**
   - [ ] Sign in with credentials
   - [ ] Sign in with GitHub
   - [ ] Create new account
   - [ ] Password reset
   - [ ] Email verification

4. **Update application code**
   - Replace NextAuth API calls with Better Auth
   - Update ~40+ files (see comprehensive guide)

### If Something Goes Wrong

1. **Rollback the migration**
   ```bash
   yarn knex migrate:rollback
   ```

2. **Restore from backup**
   ```bash
   # PostgreSQL
   psql activities_next < backup_YYYYMMDD.sql
   
   # SQLite
   cp data/database.sqlite3.backup data/database.sqlite3
   ```

3. **Report issues**
   - Check migration logs
   - Verify database state
   - Review error messages

## Migration Strategies

The comprehensive guide covers three approaches:

### 1. Column Renaming (NOT Recommended)
- Renames columns to match Better Auth exactly
- ❌ Breaking changes to all code
- ❌ High risk
- ❌ Requires downtime

### 2. Adapter Mapping (Recommended)
- Keeps existing column names
- ✅ No breaking changes
- ✅ Lower risk
- ✅ No downtime
- Uses adapter to map between naming conventions

### 3. Hybrid (Best of Both)
- Adds new columns (non-breaking)
- Uses adapter for naming differences
- ✅ Safest approach
- ✅ Most compatible
- ✅ Gradual migration possible

**We use the Hybrid approach** in the provided migration.

## FAQ

### Q: Will this break my existing authentication?
**A:** No. The migration only adds columns. Your existing NextAuth code continues working.

### Q: Do I need to update my application code immediately?
**A:** No. The migration is independent. You can apply it now and update the code later.

### Q: What about my custom fields like `actorId`?
**A:** They're preserved. The adapter handles Better Auth's expectations while keeping your customizations.

### Q: Can I rollback if there's a problem?
**A:** Yes. The migration includes a complete rollback function.

### Q: How long does the migration take?
**A:** Typically under 1 minute for most databases. Larger databases may take a few minutes.

### Q: Will there be downtime?
**A:** No downtime required. The migration is additive and doesn't affect existing operations.

### Q: Do I need to rename my tables?
**A:** No. The adapter maps between your table names and Better Auth's expectations.

### Q: What about passwords?
**A:** Your existing `passwordHash` is preserved. The adapter handles the different field names.

## Next Steps

After applying this migration:

1. **Complete the adapter implementation**
   - Map between database schema and Better Auth expectations
   - Handle type conversions (timestamps to booleans, etc.)
   - Preserve custom fields

2. **Configure Better Auth**
   - Set up authentication providers
   - Configure session management
   - Test authentication flows

3. **Update application code**
   - Replace NextAuth imports
   - Update API calls
   - Update client-side hooks
   - Test thoroughly

4. **Monitor and verify**
   - Check authentication logs
   - Monitor for errors
   - Verify all flows work
   - Test OAuth providers

## Getting Help

- **Comprehensive guide**: `docs/better-auth-schema-migration.md`
- **Quick reference**: `docs/better-auth-quick-reference.md`
- **Visual guide**: `docs/better-auth-visual-guide.md`
- **Migration file**: `migrations/20260212000000_add_better_auth_fields.js`

## Summary

This migration provides a **safe, non-breaking foundation** for Better Auth integration:

✅ Adds all required Better Auth fields
✅ Creates verification table
✅ Migrates existing data
✅ Preserves custom ActivityPub functionality
✅ Maintains backward compatibility
✅ Easy to rollback if needed

The adapter layer handles all naming differences, allowing your existing schema to work seamlessly with Better Auth.

**Ready to migrate?** Follow the step-by-step instructions above, starting with backing up your database.
