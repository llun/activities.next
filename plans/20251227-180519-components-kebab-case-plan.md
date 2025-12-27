# Plan: Kebab-Case Component Folder Refactor (lib/components)

## Goals
- Convert every CamelCase component file and directory under `lib/components/` to kebab-case.
- Use a per-component folder layout: each component lives in a folder named in kebab-case, and its primary file uses the same kebab-case name.
- Preserve component exports and runtime behavior; only paths and filenames change.

## Scope
- File moves and renames inside `lib/components/` only.
- Update import paths anywhere in the repo that reference moved components.
- Do not touch `lib/components/layout/` or `lib/components/ui/` unless they reference renamed components.
- `lib/components/posts/` already exists; only file names and internal imports need updates there.

## Naming Rules
- Folder name: kebab-case, matches component name (e.g., `ActorAttachments` -> `actor-attachments`).
- File name: kebab-case, usually matches component name (e.g., `ActorAttachments.tsx` -> `actor-attachments.tsx`).
- Test files: kebab-case and co-located with the component (e.g., `upload-media-button.test.tsx`).

## Target Structure (Old -> New)
### Top-Level Files -> Component Folders
- `lib/components/ActorAttachments.tsx`
  -> `lib/components/actor-attachments/actor-attachments.tsx`
- `lib/components/ActorTab.tsx`
  -> `lib/components/actor-tab/actor-tab.tsx`
- `lib/components/FollowAction.tsx`
  -> `lib/components/follow-action/follow-action.tsx`
- `lib/components/Header.tsx`
  -> `lib/components/header/header.tsx`
- `lib/components/MediasModal.tsx`
  -> `lib/components/medias-modal/medias-modal.tsx`
- `lib/components/Modal.tsx`
  -> `lib/components/modal/modal.tsx`
- `lib/components/Profile.tsx`
  -> `lib/components/profile/profile.tsx`
- `lib/components/TimelineLoadMoreButton.tsx`
  -> `lib/components/timeline-load-more-button/timeline-load-more-button.tsx`
- `lib/components/TimelineTabs.tsx`
  -> `lib/components/timeline-tabs/timeline-tabs.tsx`

### PostBox Module -> Kebab-Case Folder + Files
- `lib/components/PostBox/` -> `lib/components/post-box/`
- `lib/components/PostBox/PostBox.tsx`
  -> `lib/components/post-box/post-box.tsx`
- `lib/components/PostBox/ReplyPreview.tsx`
  -> `lib/components/post-box/reply-preview.tsx`
- `lib/components/PostBox/UploadMediaButton.tsx`
  -> `lib/components/post-box/upload-media-button.tsx`
- `lib/components/PostBox/UploadMediaButton.test.tsx`
  -> `lib/components/post-box/upload-media-button.test.tsx`
- `lib/components/PostBox/PollChoices.tsx`
  -> `lib/components/post-box/poll-choices.tsx`
- `lib/components/PostBox/reducers.ts`
  -> `lib/components/post-box/reducers.ts` (move only, name stays)

### Posts Module -> Kebab-Case Files
- `lib/components/posts/Posts.tsx`
  -> `lib/components/posts/posts.tsx`
- `lib/components/posts/Post.tsx`
  -> `lib/components/posts/post.tsx`
- `lib/components/posts/Attachments.tsx`
  -> `lib/components/posts/attachments.tsx`
- `lib/components/posts/Actions.tsx`
  -> `lib/components/posts/actions/actions.tsx`
- `lib/components/posts/actor.tsx`, `media.tsx`, `poll.tsx` already kebab-case.

#### Posts Actions Submodule (Name Collision Handling)
There is both an `Actions.tsx` file and an `actions/` folder today. After renaming to kebab-case, these would collide as `actions.tsx` and `actions/`. To avoid this:
- Move `lib/components/posts/Actions.tsx`
  -> `lib/components/posts/actions/actions.tsx`
- Rename button files inside the folder:
  - `DeleteButton.tsx` -> `delete-button.tsx`
  - `EditButton.tsx` -> `edit-button.tsx`
  - `EditHistoryButton.tsx` -> `edit-history-button.tsx`
  - `LikeButton.tsx` -> `like-button.tsx`
  - `ReplyButton.tsx` -> `reply-button.tsx`
  - `RepostButton.tsx` -> `repost-button.tsx`

## Import Path Update Plan
1. Update all absolute imports using `@/lib/components/...` to the new kebab-case paths.
   - Example: `@/lib/components/PostBox/PostBox`
     -> `@/lib/components/post-box/post-box`
2. Update relative imports inside moved components:
   - Example: `./Actions/DeleteButton`
     -> `./delete-button` (within `lib/components/posts/actions/actions.tsx`)
   - Example: `../Posts/Actor`
     -> `../posts/actor` (or `../../posts/actor` if the file moved deeper).
3. Ensure test imports follow the new file paths.
4. Search for old paths with:
   - `rg "lib/components/(Actor|PostBox|Posts|Timeline|Medias|Modal|Profile|Follow|Header)"`
   - `rg "@/lib/components/"`

## Execution Steps (When Approved)
1. Create a new git branch for this task before making any changes (e.g., `refactor/components-kebab-case`).
2. For each component (or component group like `post-box` or `posts`), do the refactor in isolation:
   - Rename folders/files using `git mv` to preserve history.
   - Update all relevant import paths in `lib/components/`, `lib/`, and `app/`.
   - Ensure the `actions` name collision is resolved (only `posts/actions/` exists).
3. For each component refactor, update existing tests if any move with the component.
   - No new tests are required for this rename-only refactor.
4. Commit after each component refactor:
   - One commit per component (or per grouped component, e.g., `post-box`).
   - Commit message format: imperative and short (e.g., “Refactor post-box paths”).
5. After all components are migrated:
   - Run `rg` checks to ensure no old CamelCase paths remain.
   - Run `yarn lint` and any remaining test suites as needed.
6. Create a PR for the branch:
   - Title should reflect the refactor scope (e.g., “Refactor lib/components to kebab-case”).
   - Description should summarize the kebab-case folder/file changes, import updates, and per-component tests/commits.

## Notes / Risks
- Case-only renames can be tricky on case-insensitive filesystems; use explicit `git mv` steps.
- The `Posts/Actions` collision requires moving `Actions.tsx` into the `actions` folder.
- If any imports rely on implicit index resolution, add explicit file paths or consider adding `index.ts` later (not required for this refactor).
- Adding tests for untested components may require selecting minimal, stable assertions (e.g., renders without crash, expected text/roles), to avoid brittle snapshots.
