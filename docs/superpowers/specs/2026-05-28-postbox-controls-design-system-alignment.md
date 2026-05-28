# Postbox and Controls — design-system alignment

**Status:** Approved for planning
**Date:** 2026-05-28
**Author:** llun (with Claude)
**Source design system:** `activities-next-design-system` bundle exported from
claude.ai/design — fetched via
`https://api.anthropic.com/v1/design/h/B35I5ZX6r-Hr8WyFWx6nFQ`. The relevant
files are `project/preview/controls.html`, `project/preview/composer.html`,
`project/ui_kits/web/Composer.jsx`, and `project/colors_and_type.css`.

## Goal

Bring the post-box (composer) and the three control primitives (Tabs, Progress,
Switch) into 1:1 visual alignment with the exported design system, without
losing any current functionality.

## Background

The design system was generated **from** `app/globals.css`, so design tokens
(colors, radii, shadows, type scale, spacing) already match. The deltas are
purely at the component-composition layer:

- The post-box currently has no card container, uses a 48 px avatar outside the
  form, mixes `Button` variants for toolbar actions, has no character counter,
  and exposes markdown preview via a Write/Preview tab strip.
- The design wraps the composer in a soft-shadowed rounded card, uses a 40 px
  avatar inside the card beside the textarea, puts all actions in a uniform
  toolbar of 32×32 ghost icon buttons separated by a top border, shows a
  remaining-character counter, and does not use tabs.
- `ui/tabs.tsx` already matches the design exactly.
- `ui/progress.tsx` differs only in the track color (`bg-primary/20` vs the
  design's `bg-muted`).
- `ui/switch.tsx` is undersized (`h-[1.15rem] w-8`, ≈18×32 px) vs the design's
  20×36 px pill with a 16 px thumb.

## Non-goals

- No design-token changes. `app/globals.css` is canonical and the design
  system mirrors it.
- No rewrite of post-box business logic — reducers, API calls, attachment
  state, fitness upload, polls, edit mode, and reply handling are preserved
  byte-for-byte; only presentation changes.
- No `ui/tabs.tsx` change.
- No new shared "Toolbar" or "IconButton" abstraction. The toolbar lives
  inline in `post-box.tsx`; if a second consumer appears later it can be
  extracted then.

## Design

### Postbox card

Layout (top to bottom, all inside one `bg-card border rounded-xl p-4 shadow-sm`
card):

1. **Reply preview** (existing `ReplyPreview`, conditionally rendered) — no
   visual change, just relocated inside the card.
2. **Content-warning input** — single `input` row, conditionally rendered when
   `postExtension.contentWarningVisible` is true. Same styling as today.
3. **Avatar + textarea row** — `flex gap-3`:
   - `Avatar` size-10 (40 px), `rounded-full`.
   - `textarea`: `flex-1 border-0 outline-none resize-none bg-transparent
     text-[15px] leading-relaxed min-h-[60px]
     placeholder:text-muted-foreground`. No internal padding — the card's
     `p-4` provides it.
4. **Preview overlay** — when the Eye toolbar button is toggled on, the
   textarea is replaced inline by a `div` of the same min-height containing
   the rendered markdown (using the existing `ReactMarkdown` + `rehypeSanitize`
   + `remarkBreaks` pipeline). The Eye button takes a "pressed" visual state
   (`bg-muted text-foreground`). This replaces the Write/Preview tabs.
5. **Poll editor** (existing `PollChoices`, conditionally rendered) — placed
   below the textarea/preview but above the toolbar.
6. **Toolbar row** — `flex items-center gap-1 mt-2 pt-3 border-t`:
   - `ImageIcon` → triggers the existing `UploadMediaButton` file picker.
   - `Activity` → triggers the existing `UploadFitnessFileButton`. Hidden when
     `replyStatus` is set (same condition as today).
   - `BarChart3` → toggles `postExtension.poll.showing`.
   - `AlertTriangle` → toggles content-warning visibility.
   - Visibility icon → opens the existing visibility dropdown. Keep whichever
     icon `VisibilitySelector` exposes today (do not swap to the design's
     `Globe` unless the existing selector already uses it). Visibility can
     change per-post (public, followers-only, etc.); the icon may reflect the
     current value, which `Globe` would not.
   - `Eye` → toggles preview overlay. Replaces the `currentTab` state.
   - `<div className="flex-1" />` spacer.
   - Character counter: `<span className="text-xs text-muted-foreground mr-2
     tabular-nums">{MAX_STATUS_CHARACTERS - text.length}</span>`. Turns
     `text-destructive` when negative.
   - Edit mode only: a small text button "Cancel Edit" (`variant="ghost"
     size="sm"`).
   - **Post button**: `<Button size="sm">` rendering "Post" / "Posting…" /
     "Update".
7. **Warning message row** (existing `warningMsg`) — `text-xs text-destructive
   mt-2`.
8. **Fitness file chip** (existing chip, conditionally rendered).
9. **Attachments grid** (existing `grid grid-cols-8`, conditionally rendered).

All toolbar icon buttons use the same `Button` invocation:
`<Button variant="ghost" size="icon-sm" className="text-muted-foreground
hover:bg-muted hover:text-foreground">`. If `size="icon-sm"` does not yield
32×32, add a 32×32 size variant to `ui/button.tsx`; otherwise reuse.

### Character limit constant

Add to `lib/services/mastodon/constants.ts`:

```ts
export const MAX_STATUS_CHARACTERS = 500
```

Reuse in:

- `app/api/v1/instance/route.ts` (`max_characters: MAX_STATUS_CHARACTERS`).
- `app/api/v2/instance/route.ts` (`max_characters: MAX_STATUS_CHARACTERS`).
- `lib/components/post-box/post-box.tsx` (counter and Post-button disable
  check: `text.length > MAX_STATUS_CHARACTERS` blocks submit).

Server enforcement is **out of scope** — the existing API does not enforce a
length, and we are not adding a regression-risk server check here. The cap is
advertised + UI-soft only.

### VisibilitySelector

Change the trigger element to a 32×32 ghost icon button matching the toolbar
style. Dropdown content is unchanged. The visible icon (currently a text-icon
combo) becomes icon-only.

### UploadMediaButton / UploadFitnessFileButton

Both expose a button that opens a file picker today. Change the button to the
toolbar icon style (32×32 ghost). Internal file-input + state logic is
preserved.

### Progress

`lib/components/ui/progress.tsx`: change the track from
`bg-primary/20` to `bg-muted`. Indicator stays `bg-primary`. No other changes.

### Switch

`lib/components/ui/switch.tsx`:

- Root: `h-5 w-9` (was `h-[1.15rem] w-8`).
- Thumb: stays `size-4`, but the checked translation becomes
  `data-[state=checked]:translate-x-4` (was `translate-x-[calc(100%-2px)]`).
  Use the explicit `translate-x-4` to match the design's 16 px offset cleanly.

This visibly enlarges the toggles in `NotificationSettings.tsx` and
`PushNotificationSettings.tsx`. No structural changes to those pages.

## Files to change

| File | Change |
|---|---|
| `lib/components/post-box/post-box.tsx` | Rewrite render tree per the layout above; replace `currentTab` state with a `previewMode` boolean; add char-counter logic. |
| `lib/components/post-box/post-box.test.tsx` | Update selectors (no more `TabsList`/`TabsTrigger` for Write/Preview); add coverage for counter and over-limit Post-button disable. |
| `lib/components/post-box/visibility-selector.tsx` | Change trigger to 32×32 ghost icon button. |
| `lib/components/post-box/upload-media-button.tsx` | Change trigger to 32×32 ghost icon button. |
| `lib/components/post-box/upload-fitness-file-button.tsx` | Change trigger to 32×32 ghost icon button. |
| `lib/components/ui/progress.tsx` | Track color `bg-primary/20` → `bg-muted`. |
| `lib/components/ui/switch.tsx` | Bump root to `h-5 w-9`; thumb translation to `translate-x-4`. |
| `lib/components/ui/button.tsx` | Add `size: 'icon-sm'` if not present (32×32). |
| `lib/services/mastodon/constants.ts` | Add `MAX_STATUS_CHARACTERS = 500`. |
| `app/api/v1/instance/route.ts` | Use `MAX_STATUS_CHARACTERS` for `max_characters`. |
| `app/api/v2/instance/route.ts` | Use `MAX_STATUS_CHARACTERS` for `max_characters`. |

## Acceptance criteria

- Post-box renders inside a `bg-card border rounded-xl p-4 shadow-sm` card,
  with the avatar (40 px) inside the card next to the textarea.
- The toolbar row sits below the textarea/preview, separated by a `border-t`,
  and contains uniform 32×32 ghost icon buttons in the order: image, fitness
  (hidden in reply mode), poll, content warning, visibility, preview.
- A remaining-character counter renders before the Post button and shows
  `MAX_STATUS_CHARACTERS - text.length` in `tabular-nums`. It turns
  `text-destructive` when negative.
- Post button is disabled when text length exceeds `MAX_STATUS_CHARACTERS`,
  in addition to all existing disable conditions.
- The Write/Preview tab strip is gone. Markdown preview is reached by the Eye
  toolbar button; toggling it replaces the textarea inline with the rendered
  markdown.
- `Progress` track is `bg-muted`.
- `Switch` root is `h-5 w-9` with a 16 px thumb that translates `translate-x-4`
  when checked.
- `/api/v1/instance` and `/api/v2/instance` still report
  `max_characters: 500`, sourced from the shared constant.
- All existing post-box behaviors continue to work: reply, edit, poll,
  fitness file upload, media upload with attachment grid, content warning,
  visibility selection, quick-post (Cmd/Ctrl+Enter), discard-reply,
  discard-edit, warning messages, drag-and-drop (if any).
- All existing post-box tests pass after selector updates.

## Risks and mitigations

- **Layout regression in the timeline.** The post-box is the main composer at
  the top of the timeline; the card container changes vertical rhythm.
  Mitigation: manual smoke in the browser on `/`, `/[actor]`, and a status
  reply page.
- **Settings page switches grow visibly.** This is intentional and matches the
  design. Mitigation: spot-check `/settings` after the change.
- **Icon-only buttons hurt discoverability.** Mitigation: every toolbar button
  gets a `title` and `aria-label` matching the design's labels (Attach image,
  Attach fitness file, Add poll, Content warning, Visibility, Preview).
- **`icon-sm` button size variant may not exist.** Verify in
  `lib/components/ui/button.tsx`; add the variant if missing.

## Out of scope

- Dark-mode-specific tuning (tokens already cover dark mode).
- Server enforcement of `MAX_STATUS_CHARACTERS`.
- Extraction of a shared `Toolbar` / `IconButton` component.
- Touch / mobile-specific composer changes beyond what falls out of the card
  layout.
- Other UI primitives in the design system bundle (Avatar, Card, Dialog,
  DropdownMenu, Input, Button) — covered by separate work if needed.
