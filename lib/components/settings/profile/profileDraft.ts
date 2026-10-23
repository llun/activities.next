import type {
  SavedProfile,
  UpdateProfileInput
} from '@/lib/types/domain/savedProfile'

// What the Edit profile page keeps while the person types: the saved profile
// without the link check times, which the page never edits.
export type ProfileDraft = Omit<SavedProfile, 'fields'> & {
  fields: { name: string; value: string }[]
}

export const NAME_MAX_LENGTH = 255
export const SUMMARY_MAX_LENGTH = 500
export const DESCRIPTION_MAX_LENGTH = 1500

export const toDraft = (profile: SavedProfile): ProfileDraft => ({
  ...profile,
  fields: profile.fields.map(({ name, value }) => ({ name, value }))
})

// The links as the server keeps them: trimmed, a row with both parts empty
// left out. A half-filled row stays (the field blocks Save for it).
export const normalizeFields = (
  rows: { name: string; value: string }[]
): { name: string; value: string }[] =>
  rows
    .map((row) => ({ name: row.name.trim(), value: row.value.trim() }))
    .filter((row) => row.name !== '' || row.value !== '')

const sameFields = (
  a: { name: string; value: string }[],
  b: { name: string; value: string }[]
) => {
  const left = normalizeFields(a)
  const right = normalizeFields(b)
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.name === right[index].name && row.value === right[index].value
    )
  )
}

const SCALAR_KEYS = [
  'name',
  'summary',
  'iconUrl',
  'headerImageUrl',
  'avatarDescription',
  'headerDescription',
  'showReplies',
  'showMedia',
  'showGallery',
  'showFitness'
] as const

/** The keys of the draft that differ from the last saved profile. */
export const getChangedKeys = (
  draft: ProfileDraft,
  saved: SavedProfile
): (keyof ProfileDraft)[] => {
  const changed: (keyof ProfileDraft)[] = SCALAR_KEYS.filter(
    (key) => draft[key] !== saved[key]
  )
  if (!sameFields(draft.fields, saved.fields)) changed.push('fields')
  return changed
}

export const isDraftDirty = (draft: ProfileDraft, saved: SavedProfile) =>
  getChangedKeys(draft, saved).length > 0

/**
 * The body of the save: only the keys that changed, so a save never rewrites
 * what the person did not touch (and a long bio saved long ago is not checked
 * again). A cleared image is `null`.
 */
export const buildProfilePatch = (
  draft: ProfileDraft,
  saved: SavedProfile
): UpdateProfileInput => {
  const patch: Record<string, unknown> = {}
  for (const key of getChangedKeys(draft, saved)) {
    patch[key] = key === 'fields' ? normalizeFields(draft.fields) : draft[key]
  }
  return patch as UpdateProfileInput
}

export type ProfileFieldName =
  | 'name'
  | 'summary'
  | 'fields'
  | 'iconUrl'
  | 'headerImageUrl'
  | 'avatarDescription'
  | 'headerDescription'
  | 'form'

const ERROR_FIELDS: Record<string, ProfileFieldName> = {
  name: 'name',
  summary: 'summary',
  fields: 'fields',
  iconUrl: 'iconUrl',
  headerImageUrl: 'headerImageUrl',
  avatarDescription: 'avatarDescription',
  headerDescription: 'headerDescription'
}

/**
 * Which field a 422 message is about. The save answers `Invalid <key>` for a
 * rejected value; anything else (a failed request, a message with no key) is
 * the form's own error.
 */
export const getErrorField = (message: string): ProfileFieldName => {
  const match = /^Invalid ([\w.]+)$/.exec(message)
  return (match && ERROR_FIELDS[match[1].split('.')[0]]) || 'form'
}

/**
 * Link values saved by this save that nothing has checked yet: a link that is
 * new or changed and came back unverified. The server queues the check and does
 * not say when it ends, so the page words them as "Checking…" until it reloads.
 */
export const getPendingLinkValues = (
  before: SavedProfile,
  after: SavedProfile
): string[] => {
  const known = new Set(before.fields.map((field) => field.value.trim()))
  return after.fields
    .filter((field) => !field.verifiedAt)
    .map((field) => field.value.trim())
    .filter((value) => value !== '' && !known.has(value))
}

// In the order the page lists them, which is the order the question names them.
const CHANGE_LABELS: [keyof ProfileDraft, string][] = [
  ['iconUrl', 'your avatar'],
  ['headerImageUrl', 'your header image'],
  ['avatarDescription', 'your image descriptions'],
  ['headerDescription', 'your image descriptions'],
  ['name', 'your display name'],
  ['summary', 'your bio'],
  ['fields', 'your profile fields'],
  ['showReplies', 'your profile tabs'],
  ['showMedia', 'your profile tabs'],
  ['showGallery', 'your profile tabs'],
  ['showFitness', 'your profile tabs']
]

/** "your bio and your profile fields", for the "Discard changes?" question. */
export const describeChanges = (keys: (keyof ProfileDraft)[]): string => {
  const labels = [
    ...new Set(
      CHANGE_LABELS.filter(([key]) => keys.includes(key)).map(
        ([, label]) => label
      )
    )
  ]
  if (labels.length <= 1) return labels[0] ?? 'your profile'
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}
