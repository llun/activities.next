# Technical Debt - TODO Items Tracking

This document tracks the 13 TODO items found in the codebase. These should be converted to GitHub issues for proper tracking and prioritization.

## High Priority TODOs

### 1. Support Status Visibility Features
**File**: `lib/actions/createNote.ts:19`  
**Current Comment**: `// TODO: Support status visibility public, unlist, followers only, mentions only`

**Description**: Implement different visibility levels for posts similar to Mastodon:
- Public: Visible to everyone
- Unlisted: Not shown in public timelines
- Followers only: Only visible to followers
- Mentions only: Only visible to mentioned users

**Impact**: High - Core feature for ActivityPub compatibility and user privacy
**Effort**: Medium-Large
**Suggested Issue Title**: "Implement status visibility levels (public, unlisted, followers-only, mentions-only)"

### 2. Fix Poll Schema Migration
**Files**: 
- `lib/jobs/updatePollJob.ts:36`
- `lib/jobs/createPollJob.ts:35`

**Current Comment**: `// TODO: Move Poll to schema`

**Description**: Move Poll types to the shared schema package `@llun/activities.schema` for consistency with other ActivityPub types.

**Impact**: Medium - Code organization and type safety
**Effort**: Small
**Suggested Issue Title**: "Move Poll types to @llun/activities.schema package"

### 3. Timeline Model Improvement
**File**: `lib/database/database.test.ts:121`  
**Current Comment**: `// TODO: Create timeline model that can has different query`

**Description**: Create a proper timeline model abstraction that supports different query patterns for home timeline, public timeline, user timeline, etc.

**Impact**: Medium - Better code organization and performance optimization
**Effort**: Medium
**Suggested Issue Title**: "Create timeline model abstraction with flexible query patterns"

## Medium Priority TODOs

### 4. Image Domain Configuration
**Files**: 
- `lib/services/medias/S3StorageFile.ts:69`
- `lib/services/medias/localFile.ts:53`

**Current Comment**: `// TODO: Add config for base image domain?`

**Description**: Add configuration option for base image domain/CDN URL to support serving images from a different domain or CDN.

**Impact**: Medium - Performance and flexibility for production deployments
**Effort**: Small
**Suggested Issue Title**: "Add configurable base image domain/CDN URL for media files"

### 5. Get Inboxes from Status
**File**: `lib/actions/deleteStatus.ts:19`  
**Current Comment**: `// TODO: Get inboxes from status, instead of followers?`

**Description**: When deleting a status, send Delete activities to the inboxes extracted from the status recipients rather than just followers. This ensures proper federation of deletes.

**Impact**: Medium - Better federation compliance
**Effort**: Small
**Suggested Issue Title**: "Send status deletion to actual recipients rather than just followers"

### 6. Reply Mention Names
**File**: `lib/components/post-box/post-box.tsx:153`  
**Current Comment**: `* TODO: Instead of using reply actor, it should be reply mention names`

**Description**: When replying to a post, pre-populate mentions with all users mentioned in the original post, not just the original author.

**Impact**: Medium - Better UX for threaded conversations
**Effort**: Small
**Suggested Issue Title**: "Include all mentioned users when replying to a post"

### 7. Status EndAt Field Fix
**File**: `lib/database/sql/status.ts:651`  
**Current Comment**: `// TODO: Fix this endAt in the data or making sure it's not null`

**Description**: Handle the `endAt` field in status data properly - either ensure it's not null in the database or handle null cases appropriately in the code.

**Impact**: Low-Medium - Data integrity
**Effort**: Small
**Suggested Issue Title**: "Fix endAt field handling in status data"

### 8. Differentiate Delete Object
**File**: `lib/activities/actions/deleteUser.ts:3`  
**Current Comment**: `// TODO: Check on how to differentate delete object`

**Description**: Implement proper differentiation between deleting a user (Actor) vs deleting a post (Note/Object) in ActivityPub Delete activities.

**Impact**: Medium - Proper ActivityPub compliance
**Effort**: Small
**Suggested Issue Title**: "Properly differentiate between Actor and Object deletion in ActivityPub"

### 9. Timeline Status Update
**File**: `app/(timeline)/MainPageTimeline.tsx:96`  
**Current Comment**: `// TODO: Update status in Timeline somehow.`

**Description**: Implement real-time or efficient updates of statuses in the timeline when they change (edits, likes, boosts, etc.)

**Impact**: Medium - UX improvement
**Effort**: Medium
**Suggested Issue Title**: "Implement real-time status updates in timeline"

## Low Priority TODOs

### 10. Auth Bearer for Account Creation
**File**: `app/api/v1/accounts/route.ts:26`  
**Current Comment**: `// TODO: If the request has auth bearer, return 200 instead`

**Description**: When an authenticated user tries to create an account, return 200 (success) instead of treating it as an error, as they're already authenticated.

**Impact**: Low - API consistency
**Effort**: Small
**Suggested Issue Title**: "Return 200 for authenticated users accessing account creation endpoint"

### 11. Complete Poll Creation Client
**File**: `lib/client.ts:204`  
**Current Comment**: `// TODO: Continue on create poll`

**Description**: Complete the implementation of poll creation in the client-side code.

**Impact**: Medium - Feature completion
**Effort**: Small-Medium (depends on what's missing)
**Suggested Issue Title**: "Complete poll creation client-side implementation"

## Recommended Prioritization

### Sprint 1 (High Impact)
1. Status visibility features (#1) - Core privacy feature
2. Poll schema migration (#2) - Technical debt reduction
3. Reply mention names (#6) - UX improvement

### Sprint 2 (Medium Impact)
4. Image domain configuration (#4) - Production readiness
5. Get inboxes from status (#5) - Federation compliance
6. Differentiate delete object (#8) - ActivityPub compliance

### Sprint 3 (Cleanup & Enhancement)
7. Timeline model (#3) - Code quality
8. Timeline status update (#9) - UX enhancement
9. Status endAt fix (#7) - Data integrity

### Sprint 4 (Polish)
10. Auth bearer for account creation (#10) - API polish
11. Complete poll creation (#11) - Feature completion

## Notes

- All TODOs should be converted to GitHub issues with appropriate labels (e.g., `technical-debt`, `enhancement`, `bug`)
- Link back to this document in issues for context
- Consider creating epic/project board for tracking progress
- Some TODOs may require deeper investigation before implementation
