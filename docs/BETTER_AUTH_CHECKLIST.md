# Better Auth Migration Checklist

## Pre-Migration Checklist

### Documentation Review
- [ ] Read `BETTER_AUTH_MIGRATION_README.md` (overview)
- [ ] Review `better-auth-schema-migration.md` (detailed guide)
- [ ] Check `better-auth-quick-reference.md` (quick ref)
- [ ] View `better-auth-visual-guide.md` (diagrams)
- [ ] Review migration file `20260212000000_add_better_auth_fields.js`

### Preparation
- [ ] Backup production database
- [ ] Test migration on copy of production data
- [ ] Verify backup can be restored
- [ ] Document current database state
- [ ] Review existing authentication code

## Migration Execution Checklist

### Phase 1: Database Schema (THIS PR)
- [ ] Run `yarn migrate` on development
- [ ] Verify accounts table has `name` and `image` columns
- [ ] Verify sessions table has `ipAddress` and `userAgent` columns
- [ ] Verify accountProviders table has OAuth token columns
- [ ] Verify verification table created
- [ ] Check all accounts have names populated
- [ ] Check verification codes migrated
- [ ] Verify sessions still intact
- [ ] Verify OAuth connections still work
- [ ] Test rollback on development
- [ ] Document any issues encountered
- [ ] Run migration on production (after testing)

### Phase 2: Adapter Implementation (NEXT)
- [ ] Update `lib/auth/adapter.ts` with field mapping
  - [ ] Implement `create` method for user/session/account
  - [ ] Implement `findOne` method for user/session/account
  - [ ] Implement `findMany` method for sessions
  - [ ] Implement `update` method for user/session
  - [ ] Implement `delete` method for session
  - [ ] Handle field name mapping (accountId ↔ userId, etc.)
  - [ ] Handle type conversion (timestamp ↔ boolean)
  - [ ] Preserve custom fields (actorId, passwordHash)
- [ ] Test adapter with Better Auth
- [ ] Verify all CRUD operations work

### Phase 3: Better Auth Configuration (NEXT)
- [ ] Update `lib/auth/index.ts` with Better Auth setup
  - [ ] Configure credentials provider
  - [ ] Configure GitHub OAuth provider
  - [ ] Configure session settings
  - [ ] Set up secret and origins
- [ ] Test Better Auth initialization
- [ ] Verify providers load correctly

### Phase 4: Replace NextAuth API Calls (NEXT)
Server-side updates (~20+ files):
- [ ] Update all `getServerSession` calls to use Better Auth
  - [ ] app/(timeline)/page.tsx
  - [ ] app/(timeline)/layout.tsx
  - [ ] app/(timeline)/[actor]/page.tsx
  - [ ] app/(timeline)/[actor]/followers/page.tsx
  - [ ] app/(timeline)/[actor]/following/page.tsx
  - [ ] app/(timeline)/[actor]/[status]/page.tsx
  - [ ] app/(timeline)/notifications/page.tsx
  - [ ] app/(timeline)/settings/page.tsx
  - [ ] app/(timeline)/settings/account/page.tsx
  - [ ] app/(timeline)/settings/account/verify-email/page.tsx
  - [ ] app/(timeline)/settings/sessions/page.tsx
  - [ ] app/(timeline)/settings/notifications/page.tsx
  - [ ] app/(timeline)/settings/media/page.tsx
  - [ ] app/(nosidebar)/auth/signin/page.tsx
  - [ ] app/(nosidebar)/auth/signup/page.tsx
  - [ ] app/(nosidebar)/auth/select-actor/page.tsx
  - [ ] app/(nosidebar)/auth/forgot-password/page.tsx
  - [ ] app/(nosidebar)/auth/confirmation/page.tsx
  - [ ] app/(nosidebar)/oauth/authorize/page.tsx
  - [ ] lib/services/guards/AuthenticatedGuard.ts
  - [ ] lib/services/guards/OAuthGuard.ts
  - [ ] app/api/v1/actors/switch/route.ts
  - [ ] app/api/v1/accounts/providers/[provider]/route.ts

Client-side updates (~10+ files):
- [ ] Update `signIn` calls to Better Auth
  - [ ] app/(nosidebar)/auth/signin/SigninButton.tsx
  - [ ] app/(nosidebar)/auth/signin/CredentialForm.tsx
  - [ ] app/(timeline)/settings/AuthenticationProviders.tsx
- [ ] Update `signOut` calls to Better Auth
  - [ ] app/(timeline)/settings/LogoutButton.tsx
- [ ] Update `getProviders` calls to Better Auth
  - [ ] app/(nosidebar)/auth/signin/page.tsx
  - [ ] app/(timeline)/settings/page.tsx
- [ ] Remove NextAuth client provider if used

### Phase 5: Testing
Authentication flows:
- [ ] Test credentials sign-in
- [ ] Test credentials sign-up
- [ ] Test GitHub OAuth sign-in
- [ ] Test GitHub OAuth linking
- [ ] Test GitHub OAuth unlinking
- [ ] Test password reset flow
- [ ] Test email verification flow
- [ ] Test email change flow
- [ ] Test session management
- [ ] Test multiple actors per account
- [ ] Test actor switching

Pages/Routes:
- [ ] Test all authenticated pages load
- [ ] Test all authentication guards work
- [ ] Test OAuth callbacks work
- [ ] Test API endpoints with authentication
- [ ] Test protected routes redirect properly

Edge cases:
- [ ] Test expired sessions
- [ ] Test invalid tokens
- [ ] Test concurrent sessions
- [ ] Test session refresh
- [ ] Test CSRF protection
- [ ] Test rate limiting

### Phase 6: Update Tests
- [ ] Update NextAuth mocks to Better Auth mocks
  - [ ] lib/services/guards/AuthenticatedGuard.test.ts
  - [ ] lib/services/guards/OAuthGuard.test.ts
  - [ ] app/api/v1/actors/route.test.ts
  - [ ] app/api/v1/actors/domains/route.test.ts
  - [ ] app/api/v1/settings/fitness/strava/route.test.ts
- [ ] Update auth adapter tests
  - [ ] lib/services/auth/storageAdapter.test.ts → lib/auth/adapter.test.ts
- [ ] Update auth options tests
  - [ ] app/api/auth/[...nextauth]/authOptions.test.ts → lib/auth/index.test.ts
- [ ] Run full test suite
- [ ] Fix any failing tests

### Phase 7: Cleanup (OPTIONAL)
- [ ] Remove NextAuth dependencies from package.json
- [ ] Remove old NextAuth route files
- [ ] Remove old adapter files
- [ ] Archive old verification code columns
  - [ ] Consider removing accounts.verificationCode
  - [ ] Consider removing accounts.passwordResetCode
  - [ ] Create cleanup migration if needed
- [ ] Update documentation
- [ ] Update environment variable examples

## Post-Migration Checklist

### Monitoring
- [ ] Monitor authentication logs
- [ ] Check for error rates
- [ ] Verify all flows working in production
- [ ] Monitor session creation/deletion
- [ ] Check OAuth provider statistics

### Documentation
- [ ] Update README if needed
- [ ] Document any gotchas discovered
- [ ] Update deployment documentation
- [ ] Update developer onboarding docs
- [ ] Create runbook for common issues

### Optimization (OPTIONAL)
- [ ] Review adapter performance
- [ ] Optimize field mapping logic
- [ ] Add caching if beneficial
- [ ] Review session management settings
- [ ] Consider adding two-factor auth

## Rollback Checklist (If Needed)

### Immediate Actions
- [ ] Stop deployments
- [ ] Rollback migration: `yarn knex migrate:rollback`
- [ ] Restore database from backup
- [ ] Verify old authentication working
- [ ] Communicate status to team

### Investigation
- [ ] Review error logs
- [ ] Check database state
- [ ] Verify data integrity
- [ ] Document issues encountered
- [ ] Plan fixes for next attempt

### Recovery
- [ ] Test fixes on development
- [ ] Plan next migration attempt
- [ ] Update documentation with lessons learned
- [ ] Review rollback procedures

## Status Tracking

### Current Status
```
[ ] Phase 1: Database Schema ← YOU ARE HERE
[ ] Phase 2: Adapter Implementation
[ ] Phase 3: Better Auth Configuration
[ ] Phase 4: Replace NextAuth API Calls
[ ] Phase 5: Testing
[ ] Phase 6: Update Tests
[ ] Phase 7: Cleanup
```

### Timeline Estimate
- Phase 1: 1 hour (schema migration)
- Phase 2: 4 hours (adapter implementation)
- Phase 3: 2 hours (Better Auth config)
- Phase 4: 8 hours (update API calls)
- Phase 5: 4 hours (testing)
- Phase 6: 4 hours (update tests)
- Phase 7: 2 hours (cleanup)
**Total: ~25 hours over multiple days**

### Notes
- Schema migration (Phase 1) is non-breaking
- Can deploy Phase 1 independently
- Phases 2-4 should be done together
- Phase 5 is critical before production
- Phase 6 ensures CI/CD stability
- Phase 7 is optional cleanup

## Quick Reference

### Current Schema
```
accounts (id, email, passwordHash, verifiedAt, emailVerifiedAt, ...)
sessions (id, accountId, token, expireAt, actorId, ...)
accountProviders (id, accountId, provider, providerId, ...)
```

### After Migration
```
accounts (id, email, name, image, passwordHash, verifiedAt, ...)
sessions (id, accountId, token, expireAt, actorId, ipAddress, userAgent, ...)
accountProviders (id, accountId, provider, providerId, accessToken, ...)
verification (id, identifier, value, expiresAt, ...)
```

### Field Mapping
```
accounts → user (via adapter)
  accountId → userId
  emailVerifiedAt → emailVerified (timestamp to boolean)

sessions → session (via adapter)
  accountId → userId
  expireAt → expiresAt

accountProviders → account (via adapter)
  accountId → userId
  provider → providerId
  providerId → accountId
```

## Resources

- **Overview**: `docs/BETTER_AUTH_MIGRATION_README.md`
- **Detailed**: `docs/better-auth-schema-migration.md`
- **Quick Ref**: `docs/better-auth-quick-reference.md`
- **Visual**: `docs/better-auth-visual-guide.md`
- **Migration**: `migrations/20260212000000_add_better_auth_fields.js`
- **Better Auth Docs**: https://www.better-auth.com/docs

## Success Criteria

✅ All schema changes applied successfully
✅ All existing data migrated correctly
✅ All authentication flows working
✅ All OAuth providers functional
✅ All tests passing
✅ No authentication errors in production
✅ Session management working correctly
✅ Multi-actor support preserved
✅ Performance acceptable
✅ Team trained on new system

---

**Last Updated**: February 12, 2026
**Status**: Phase 1 Complete (Schema Migration)
**Next**: Phase 2 (Adapter Implementation)
