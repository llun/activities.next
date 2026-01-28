# Type Consolidation Plan

This document outlines the plan to consolidate all type definitions in the project into a single, organized location.

## Table of Contents

- [Current State Analysis](#current-state-analysis)
- [Problems Identified](#problems-identified)
- [Proposed Structure](#proposed-structure)
- [Duplicate Analysis](#duplicate-analysis)
- [Migration Strategy](#migration-strategy)
- [Naming Conventions](#naming-conventions)
- [Implementation Steps](#implementation-steps)

---

## Current State Analysis

### Type Definition Locations

Types are currently scattered across 6 different locations:

| Location | Purpose | File Count |
|----------|---------|------------|
| `lib/models/` | Domain/Business models (Zod) | 14 files |
| `lib/schema/` | ActivityPub protocol schemas (Zod) | 30+ files |
| `lib/schema/mastodon/` | Mastodon API response schemas (Zod) | 15+ files |
| `lib/database/types/` | Database operation params & interfaces | 20+ files |
| `lib/database/types/sql.ts` | SQL row type definitions | 1 file |
| `lib/activities/entities/` | ActivityPub entities (TS interfaces) | 14 files |
| `lib/activities/types.ts` | WebFinger and related types | 1 file |

**Total: ~95 files containing type definitions**

### Current Type Examples

**Actor** is defined in 3 places:
- `lib/models/actor.ts` - Internal domain model
- `lib/schema/actor.ts` - ActivityPub Actor (Person/Service)
- `lib/activities/entities/person.ts` - ActivityPub Person interface

**Document** is defined in 2 places:
- `lib/schema/note/document.ts` - Zod schema
- `lib/activities/entities/document.ts` - TypeScript interface

---

## Problems Identified

### 1. Name Collisions
Same names used for different concepts:
- `Actor` (domain) vs `Actor` (ActivityPub)
- `Account` (domain) vs `Account` (Mastodon API)
- `Status` (domain) vs `Status` (Mastodon API)

### 2. Duplicate Definitions
TypeScript interfaces in `lib/activities/entities/` duplicate Zod schemas in `lib/schema/`:
- `document.ts` (interface) ↔ `schema/note/document.ts` (Zod)
- `image.ts` (interface) ↔ `schema/image.ts` (Zod)
- `person.ts` (interface) ↔ `schema/actor.ts` (Zod)
- `collection.ts` (interface) ↔ `schema/collection.ts` (Zod)

### 3. Scattered Transformations
Type conversion logic is spread across many files:
- `lib/database/sql/actor.ts` → `getActor()`, `getMastodonActor()`
- `lib/models/status.ts` → `fromNote()`, `toActivityPubObject()`
- `lib/utils/getPersonFromActor.ts` → `getPersonFromActor()`
- `lib/services/mastodon/getMastodonStatus.ts` → `getMastodonStatus()`

### 4. Inconsistent Patterns
- Some places use Zod schemas
- Some places use TypeScript interfaces
- No clear convention for when to use which

---

## Proposed Structure

### New Directory Layout

```
lib/types/
├── index.ts                    # Main exports
│
├── domain/                     # Internal business models (SOURCE OF TRUTH)
│   ├── index.ts
│   ├── actor.ts                # Actor, ActorProfile
│   ├── account.ts              # Account
│   ├── status.ts               # Status, StatusNote, StatusPoll, StatusAnnounce
│   ├── attachment.ts           # Attachment, UploadedAttachment
│   ├── tag.ts                  # Tag, TagType
│   ├── follow.ts               # Follow types
│   ├── session.ts              # Session
│   └── pollChoice.ts           # PollChoice
│
├── database/                   # Database layer types
│   ├── index.ts
│   ├── rows.ts                 # SQL row types (SQLActor, SQLAccount, etc.)
│   └── operations.ts           # Operation params & database interfaces
│
├── activitypub/                # ActivityPub protocol types
│   ├── index.ts
│   ├── actor.ts                # APActor, APPerson, APService
│   ├── activities.ts           # Accept, Follow, Like, Announce, Undo, Reject
│   ├── objects.ts              # Note, Question, Document, Image, Tombstone
│   ├── collections.ts          # Collection, OrderedCollection, pages
│   └── webfinger.ts            # WebFinger, Link
│
└── mastodon/                   # Mastodon API response types
    ├── index.ts
    ├── account.ts              # Account, Field, Source, Relationship
    ├── status.ts               # Status, Mention, Tag, Application
    ├── poll.ts                 # Poll, PollOption
    ├── mediaAttachment.ts      # MediaAttachment variants
    ├── notification.ts         # Notification types
    ├── filter.ts               # Filter, FilterResult
    └── instance.ts             # Instance info types
```

### Type Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                     External APIs                                │
│  ┌─────────────────┐           ┌─────────────────┐              │
│  │  Mastodon API   │           │  ActivityPub    │              │
│  │  Response Types │           │  Protocol Types │              │
│  │                 │           │                 │              │
│  │ lib/types/      │           │ lib/types/      │              │
│  │ mastodon/       │           │ activitypub/    │              │
│  └────────┬────────┘           └────────┬────────┘              │
│           │                             │                        │
│           │    ┌────────────────────────┘                        │
│           │    │                                                 │
│           ▼    ▼                                                 │
│  ┌────────────────────────────────────────────┐                 │
│  │                                            │                 │
│  │        lib/types/domain/                   │  ◄── Source     │
│  │                                            │      of Truth   │
│  │   Actor, Status, Account, Follow, etc.     │                 │
│  │                                            │                 │
│  └────────────────────┬───────────────────────┘                 │
│                       │                                          │
│                       ▼                                          │
│  ┌────────────────────────────────────────────┐                 │
│  │        lib/types/database/                 │                 │
│  │                                            │                 │
│  │   SQLActor, SQLStatus, operation params    │                 │
│  └────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Duplicate Analysis

### Files to Delete (replaced by Zod schemas)

| File | Replacement |
|------|-------------|
| `lib/activities/entities/document.ts` | `lib/types/activitypub/objects.ts` |
| `lib/activities/entities/image.ts` | `lib/types/activitypub/objects.ts` |
| `lib/activities/entities/collection.ts` | `lib/types/activitypub/collections.ts` |
| `lib/activities/entities/person.ts` | `lib/types/activitypub/actor.ts` |
| `lib/activities/entities/propertyValue.ts` | `lib/types/activitypub/objects.ts` |
| `lib/activities/entities/follow.ts` | `lib/types/activitypub/activities.ts` |

### Files to Merge

| Files | Merge Into |
|-------|------------|
| `lib/activities/entities/base.ts` | `lib/types/activitypub/index.ts` |
| `lib/activities/entities/orderedCollection.ts` | `lib/types/activitypub/collections.ts` |
| `lib/activities/entities/orderedCollectionPage.ts` | `lib/types/activitypub/collections.ts` |
| `lib/activities/entities/collectionPage.ts` | `lib/types/activitypub/collections.ts` |
| `lib/activities/entities/featuredOrderedCollection.ts` | `lib/types/activitypub/collections.ts` |
| `lib/activities/types.ts` | `lib/types/activitypub/webfinger.ts` |

### Files to Keep (utility functions, not types)

| File | Reason |
|------|--------|
| `lib/activities/entities/note.ts` | Contains utility functions (`getContent`, `getReply`, etc.) |

### Consolidation Summary

**Database types** (12+ files → 2 files):
```
lib/database/types/actor.ts
lib/database/types/status.ts
lib/database/types/account.ts
lib/database/types/follow.ts        →  lib/types/database/operations.ts
lib/database/types/like.ts
lib/database/types/media.ts
lib/database/types/notification.ts
lib/database/types/oauth.ts
lib/database/types/timeline.ts
lib/database/types/base.ts

lib/database/types/sql.ts           →  lib/types/database/rows.ts
```

**ActivityPub schemas** (20+ files → 4 files):
```
lib/schema/actor.ts
lib/schema/accept.ts
lib/schema/follow.ts
lib/schema/like.ts                  →  lib/types/activitypub/activities.ts
lib/schema/announce.ts
lib/schema/reject.ts
lib/schema/undo.ts

lib/schema/content.ts
lib/schema/image.ts
lib/schema/tombstone.ts             →  lib/types/activitypub/objects.ts
lib/schema/note/*.ts

lib/schema/collection.ts            →  lib/types/activitypub/collections.ts
```

### File Count Comparison

| Location | Before | After |
|----------|--------|-------|
| `lib/models/` | 14 files | 0 (moved to `lib/types/domain/`) |
| `lib/schema/` | 30+ files | 0 (moved to `lib/types/activitypub/`) |
| `lib/schema/mastodon/` | 15+ files | 0 (moved to `lib/types/mastodon/`) |
| `lib/database/types/` | 20+ files | 0 (moved to `lib/types/database/`) |
| `lib/activities/entities/` | 14 files | 1 file (note.ts - utilities only) |
| `lib/activities/types.ts` | 1 file | 0 (moved) |
| **`lib/types/`** | 0 | ~20 files |

**Net reduction: ~95 files → ~21 files (78% reduction)**

---

## Migration Strategy

### Phase 1: Create New Structure (Non-Breaking)

1. Create `lib/types/` directory with all subdirectories
2. Create new consolidated type files
3. Add `index.ts` files with all exports
4. All existing code continues to work

### Phase 2: Add Backward-Compatible Re-exports

Update old files to re-export from new locations:

```typescript
// lib/models/actor.ts (becomes re-export)
export * from '@/lib/types/domain/actor'

// lib/schema/index.ts (becomes re-export)
export * from '@/lib/types/activitypub'
export * as Mastodon from '@/lib/types/mastodon'

// lib/database/types/actor.ts (becomes re-export)
export * from '@/lib/types/database'
```

### Phase 3: Update Imports Gradually

1. Update imports in batches (by directory)
2. Run tests after each batch
3. Use IDE refactoring tools where possible

### Phase 4: Remove Old Files

1. Delete empty re-export files
2. Remove `lib/activities/entities/` (except note.ts)
3. Remove old scattered type files
4. Update any remaining references

---

## Naming Conventions

### Within Namespaced Directories

No prefixes needed - use directory namespace:

```typescript
// Domain types
import { Actor, Status } from '@/lib/types/domain'

// Mastodon types (use namespace to avoid collision)
import * as Mastodon from '@/lib/types/mastodon'
// Usage: Mastodon.Account, Mastodon.Status

// ActivityPub types
import { Note, Follow } from '@/lib/types/activitypub'
```

### Exception: ActivityPub Actor

Use `APActor` prefix to distinguish from domain `Actor`:

```typescript
// In lib/types/activitypub/actor.ts
export const APActor = z.object({ ... })
export type APActor = z.infer<typeof APActor>

// Convenience aliases
export const APPerson = APActor
export const APService = APActor
```

### Import Examples After Migration

```typescript
// Domain models (internal use)
import { Actor, Status, Account } from '@/lib/types/domain'

// ActivityPub protocol (federation)
import { APActor, Note, Follow, Like } from '@/lib/types/activitypub'

// Mastodon API (client responses)
import * as Mastodon from '@/lib/types/mastodon'
// Or individual imports:
import { Account, Status } from '@/lib/types/mastodon'

// Database operations
import { SQLActor, CreateActorParams, ActorDatabase } from '@/lib/types/database'

// Combined import
import { Actor } from '@/lib/types/domain'
import { APActor } from '@/lib/types/activitypub'
import * as Mastodon from '@/lib/types/mastodon'
```

---

## Implementation Steps

### Step 1: Create Directory Structure

```bash
mkdir -p lib/types/{domain,database,activitypub,mastodon}
```

### Step 2: Create Domain Types

Move and consolidate from `lib/models/`:

- [ ] `lib/types/domain/actor.ts` - from `lib/models/actor.ts`
- [ ] `lib/types/domain/account.ts` - from `lib/models/account.ts`
- [ ] `lib/types/domain/status.ts` - from `lib/models/status.ts`
- [ ] `lib/types/domain/attachment.ts` - from `lib/models/attachment.ts`
- [ ] `lib/types/domain/tag.ts` - from `lib/models/tag.ts`
- [ ] `lib/types/domain/follow.ts` - from `lib/models/follow.ts`
- [ ] `lib/types/domain/session.ts` - from `lib/models/session.ts`
- [ ] `lib/types/domain/pollChoice.ts` - from `lib/models/pollChoice.ts`
- [ ] `lib/types/domain/index.ts` - exports

### Step 3: Create Database Types

Consolidate from `lib/database/types/`:

- [ ] `lib/types/database/rows.ts` - from `lib/database/types/sql.ts`
- [ ] `lib/types/database/operations.ts` - merge all operation params
- [ ] `lib/types/database/index.ts` - exports

### Step 4: Create ActivityPub Types

Consolidate from `lib/schema/` and `lib/activities/entities/`:

- [ ] `lib/types/activitypub/actor.ts` - from `lib/schema/actor.ts`
- [ ] `lib/types/activitypub/activities.ts` - merge Accept, Follow, Like, etc.
- [ ] `lib/types/activitypub/objects.ts` - merge Note, Document, Image, etc.
- [ ] `lib/types/activitypub/collections.ts` - merge Collection types
- [ ] `lib/types/activitypub/webfinger.ts` - from `lib/activities/types.ts`
- [ ] `lib/types/activitypub/index.ts` - exports

### Step 5: Create Mastodon Types

Move from `lib/schema/mastodon/`:

- [ ] `lib/types/mastodon/account.ts`
- [ ] `lib/types/mastodon/status.ts`
- [ ] `lib/types/mastodon/poll.ts`
- [ ] `lib/types/mastodon/mediaAttachment.ts`
- [ ] `lib/types/mastodon/notification.ts`
- [ ] `lib/types/mastodon/filter.ts`
- [ ] `lib/types/mastodon/index.ts` - exports

### Step 6: Create Main Index

- [ ] `lib/types/index.ts` - main export file

### Step 7: Add Re-exports to Old Locations

- [ ] Update `lib/models/*.ts` to re-export
- [ ] Update `lib/schema/*.ts` to re-export
- [ ] Update `lib/database/types/*.ts` to re-export

### Step 8: Update Imports

- [ ] Update `lib/` imports
- [ ] Update `app/` imports
- [ ] Run tests after each batch

### Step 9: Cleanup

- [ ] Remove old type files
- [ ] Remove `lib/activities/entities/` (except note.ts)
- [ ] Update documentation

---

## Testing Strategy

1. **After each step**: Run `yarn test` to ensure no regressions
2. **After re-exports**: Verify all imports still resolve
3. **After import updates**: Run `yarn lint` and `yarn build`
4. **Final verification**: Full test suite + manual testing

---

## Rollback Plan

If issues arise:
1. Re-exports ensure backward compatibility
2. Can revert import changes file-by-file
3. Old files not deleted until final verification

---

## Timeline Estimate

| Phase | Tasks |
|-------|-------|
| Phase 1 | Create new structure, move types |
| Phase 2 | Add re-exports for backward compatibility |
| Phase 3 | Update imports across codebase |
| Phase 4 | Remove old files, final cleanup |

---

## Success Criteria

- [ ] All types in `lib/types/` directory
- [ ] No duplicate type definitions
- [ ] Clear naming conventions followed
- [ ] All tests passing
- [ ] Build succeeds
- [ ] ~78% reduction in type files (95 → 21)
