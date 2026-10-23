'use client'

import { Info } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FC,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import { ApiRequestError, updateProfile } from '@/lib/client'
import type { CustomEmojiTextProps } from '@/lib/components/actors/ActorDisplayName'
import { BackLink } from '@/lib/components/back-link'
import { breakoutStyle } from '@/lib/components/layout/chromeLayout'
import { PageHeader } from '@/lib/components/page-header'
import { ConfirmDialog } from '@/lib/components/photo-editor/ConfirmDialog'
import { ProfileFieldsField } from '@/lib/components/settings/ProfileFieldsField'
import { PROFILE_FIELDS_FIRST_CONTROL_ID } from '@/lib/components/settings/profileFieldsFieldIds'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Switch } from '@/lib/components/ui/switch'
import { Textarea } from '@/lib/components/ui/textarea'
import type { SavedProfile } from '@/lib/types/domain/savedProfile'

import { FeaturedTagsSection } from './FeaturedTagsSection'
import { ProfileImageField } from './ProfileImageField'
import { ProfilePreview } from './ProfilePreview'
import {
  PROFILE_SAVED_MESSAGE,
  PROFILE_SAVED_TITLE,
  ProfileSavedToast
} from './ProfileSavedToast'
import { EDIT_PROFILE_PATH } from './SwitchedNotice'
import {
  NAME_MAX_LENGTH,
  type ProfileDraft,
  type ProfileFieldName,
  SUMMARY_MAX_LENGTH,
  buildProfilePatch,
  describeChanges,
  getChangedKeys,
  getErrorField,
  getPendingLinkValues,
  mergePendingLinks,
  reconcileDraft,
  toDraft
} from './profileDraft'
import { setUnsavedProfileChanges } from './unsavedProfileChanges'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'

interface Props {
  /** The actor this page was loaded for; a save for any other is refused. */
  actorId: string
  /** The profile as it is saved now. */
  profile: SavedProfile
  username: string
  /** `@username@domain`. */
  handle: string
  /** The public profile URL, for the `rel="me"` snippet. */
  profileUrl: string
  /** The profile page in this app, where Back and Cancel lead. */
  profilePath: string
  /** The actor's custom emoji, so link values show shortcodes as images. */
  tags?: CustomEmojiTextProps['tags']
  /** The page was opened with `?switched=1`; the first save drops it. */
  switched?: boolean
}

const TAB_ROWS = [
  { key: 'showReplies', label: 'Replies' },
  { key: 'showMedia', label: 'Media' },
  {
    key: 'showGallery',
    label: 'Gallery',
    hint: 'Your photo subjects, albums and map.'
  },
  {
    key: 'showFitness',
    label: 'Fitness',
    hint: 'Your activities and heatmap.'
  }
] as const

// Where focus goes after a failed save, by the field the message is about.
const FOCUS_SELECTORS: Record<Exclude<ProfileFieldName, 'form'>, string> = {
  name: '#profileNameInput',
  summary: '#profileSummaryInput',
  fields: `#${PROFILE_FIELDS_FIRST_CONTROL_ID}`,
  iconUrl: '[data-focus-target="iconUrl"]',
  headerImageUrl: '[data-focus-target="headerImageUrl"]',
  avatarDescription: '[data-focus-target="avatarDescription"]',
  headerDescription: '[data-focus-target="headerDescription"]'
}

const FIELD_ERROR_CLASS = 'text-destructive-text mt-1 text-xs'

/**
 * The Edit profile page's client side: photos, name and bio, profile links,
 * featured hashtags and profile tabs, with one Save for everything but the
 * hashtags (those save as you add and remove them, as they always did).
 * Saving sends only the changed keys as JSON through `updateProfile()`; the
 * profile it answers with becomes the baseline the page compares against, so
 * the page is clean after a save and dirty again only for a later edit.
 */
export const ProfileEditor: FC<Props> = ({
  actorId,
  profile,
  username,
  handle,
  profileUrl,
  profilePath,
  tags,
  switched = false
}) => {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const formId = useId()
  const [saved, setSaved] = useState(profile)
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile))
  const [pendingLinks, setPendingLinks] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<
    Partial<Record<ProfileFieldName, string>>
  >({})
  const [uploads, setUploads] = useState({ avatar: false, header: false })
  const [focusAfterError, setFocusAfterError] =
    useState<ProfileFieldName | null>(null)
  const [toastId, setToastId] = useState<number | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  // The session moved to another profile while this page stayed open.
  const [actorChanged, setActorChanged] = useState(false)

  const changedKeys = getChangedKeys(draft, saved)
  const dirty = changedKeys.length > 0
  const guard = useUnsavedChangesGuard(dirty)

  // Tells the actor switcher, which asks before it changes the session.
  useEffect(() => {
    setUnsavedProfileChanges(dirty)
    return () => setUnsavedProfileChanges(false)
  }, [dirty])
  const uploading = uploads.avatar || uploads.header
  const hasError = Object.keys(errors).length > 0

  const change = useCallback((changes: Partial<ProfileDraft>) => {
    setDraft((current) => ({ ...current, ...changes }))
    // An edit answers a failure that belongs to no field ("Couldn’t save").
    setErrors((current) => {
      if (!current.form) return current
      const next = { ...current }
      delete next.form
      return next
    })
  }, [])
  const clearError = (field: ProfileFieldName) =>
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  const handleRowsChange = useCallback(
    (rows: { name: string; value: string }[]) => {
      change({ fields: rows })
      setErrors((current) => {
        if (!current.fields) return current
        const next = { ...current }
        delete next.fields
        return next
      })
    },
    [change]
  )

  // Nothing left to save (the edits were undone): a failure from before no
  // longer applies, and the bar goes back to its calm note.
  useEffect(() => {
    if (!dirty) {
      setErrors((current) => (Object.keys(current).length === 0 ? current : {}))
    }
  }, [dirty])

  // After a failed save, focus goes to the invalid control (the form's own
  // Alert for any other failure) once it is on the page.
  useEffect(() => {
    if (focusAfterError === null) return
    setFocusAfterError(null)
    const target =
      focusAfterError === 'form'
        ? alertRef.current
        : formRef.current?.querySelector<HTMLElement>(
            FOCUS_SELECTORS[focusAfterError]
          )
    target?.scrollIntoView?.({ block: 'center' })
    target?.focus({ preventScroll: true })
  }, [focusAfterError])

  // Every save would be refused now, so Save stays off; the draft stays so
  // the person can still copy their text out. Focus goes to the Alert.
  const handleActorChanged = useCallback(() => {
    setActorChanged(true)
    setFocusAfterError('form')
  }, [])

  // The edits were undone or a save landed while the Cancel question was open:
  // there is nothing left to discard.
  useEffect(() => {
    if (!dirty) setConfirmingCancel(false)
  }, [dirty])

  const handleSave = async () => {
    if (actorChanged || saving || uploading || !dirty) return
    // The link rows block a half-filled row through the browser's own checks.
    if (formRef.current && !formRef.current.reportValidity()) return
    // What is sent is a snapshot: the person can keep typing while it saves.
    const sent = draft
    const before = saved
    setSaving(true)
    setErrors({})
    try {
      const result = await updateProfile({
        ...buildProfilePatch(sent, before),
        actorId
      })
      setPendingLinks((current) =>
        mergePendingLinks(current, getPendingLinkValues(before, result), result)
      )
      setSaved(result)
      // The server's copy is the truth (it trims the alt texts) for whatever
      // was not edited since the save was sent; those edits stay and keep the
      // page unsaved. The link rows keep what the field holds.
      setDraft((current) => reconcileDraft(current, sent, result))
      setToastId((current) => (current ?? 0) + 1)
      // The switch notice has done its job once a save went through.
      if (switched) router.replace(EDIT_PROFILE_PATH)
      else router.refresh()
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        handleActorChanged()
        return
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to save profile'
      const field =
        error instanceof ApiRequestError && error.status === 422
          ? getErrorField(message)
          : 'form'
      setErrors({ [field]: message })
      setFocusAfterError(field)
    } finally {
      setSaving(false)
    }
  }

  const leave = () => {
    guard.allowNavigation()
    router.push(profilePath)
  }
  const handleCancel = () => {
    if (dirty) setConfirmingCancel(true)
    else leave()
  }
  const dismissToast = useCallback(() => setToastId(null), [])

  const savedFields = useMemo(
    () =>
      saved.fields.map((field) => ({
        name: field.name,
        value: field.value,
        verifiedAt: field.verifiedAt ? Date.parse(field.verifiedAt) : null
      })),
    [saved.fields]
  )
  const initial = (draft.name.trim() || username).charAt(0).toUpperCase()
  const question = confirmingCancel || guard.pending

  const saveBar = (
    <SaveBar
      dirty={dirty}
      saving={saving}
      saved={false}
      dirtyLabel="You have unsaved changes"
      actionLabel="Save changes"
      submit
      formId={formId}
      disabledReason={uploading ? 'Uploading a picture…' : undefined}
      disabled={actorChanged}
      errorLive={!actorChanged}
      error={
        actorChanged
          ? dirty
            ? 'Couldn’t save your profile.'
            : null
          : hasError
            ? errors.form
              ? 'Couldn’t save your profile.'
              : 'Fix the highlighted field to save.'
            : null
      }
      actions={
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      }
    />
  )

  return (
    <div className="space-y-6">
      {/* One polite region, always mounted, so the save is announced. */}
      <div role="status" aria-live="polite" className="sr-only">
        {toastId !== null ? (
          // A new node for every save, so a second save while the first
          // message is still up is announced again.
          <span key={toastId}>
            {PROFILE_SAVED_TITLE}. {PROFILE_SAVED_MESSAGE}
          </span>
        ) : null}
      </div>

      {/* Phones: Cancel, the title and Save in one bar at the top. */}
      <div
        data-slot="profile-editor-phone-bar"
        // Sticky under the settings section's own mobile bar (56px plus the
        // top safe area and, while the app is not online, the connection strip
        // below it, z-30), so it never covers it: one z-step below.
        className="sticky top-[calc(56px+env(safe-area-inset-top,0px)+var(--status-strip-h,0px))] z-20 flex items-center justify-between gap-2 border-b bg-background px-4 py-2 md:hidden"
        style={breakoutStyle}
      >
        <Button type="button" variant="ghost" onClick={handleCancel}>
          Cancel
        </Button>
        <h2 className="text-base font-semibold">Edit profile</h2>
        <Button
          type="submit"
          form={formId}
          disabled={!dirty || saving || uploading || actorChanged}
        >
          Save
        </Button>
      </div>

      <div className="max-md:hidden">
        <BackLink
          href={profilePath}
          accessibleName="Back to your profile"
          label="Back to your profile"
          prefetch={false}
          className="mb-3"
        />
        <PageHeader
          title="Edit profile"
          description={`${handle} · Everything here is public and is sent to servers that follow you when you save.`}
        />
      </div>

      {actorChanged || errors.form ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          {actorChanged ? (
            <Alert
              title="Couldn’t save your profile"
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </Button>
              }
            >
              You switched to another profile, so this page is out of date.
              Reload to edit the profile you’re using now.
            </Alert>
          ) : (
            <Alert title="Couldn’t save your profile">{errors.form}</Alert>
          )}
        </div>
      ) : null}

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start xl:gap-8">
        <div className="min-w-0 space-y-6">
          <form
            ref={formRef}
            id={formId}
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault()
              handleSave()
            }}
          >
            <Section
              title="Photos"
              description="Your avatar and the header across the top of your profile."
            >
              <Frame form>
                <ProfileImageField
                  kind="header"
                  url={draft.headerImageUrl}
                  alt={draft.headerDescription}
                  initial={initial}
                  imageError={errors.headerImageUrl}
                  altError={errors.headerDescription}
                  onUrlChange={(headerImageUrl) => {
                    clearError('headerImageUrl')
                    change({ headerImageUrl })
                  }}
                  onAltChange={(headerDescription) => {
                    clearError('headerDescription')
                    change({ headerDescription })
                  }}
                  onUploadingChange={(header) =>
                    setUploads((current) => ({ ...current, header }))
                  }
                />
                <ProfileImageField
                  kind="avatar"
                  url={draft.iconUrl}
                  alt={draft.avatarDescription}
                  initial={initial}
                  imageError={errors.iconUrl}
                  altError={errors.avatarDescription}
                  onUrlChange={(iconUrl) => {
                    clearError('iconUrl')
                    change({ iconUrl })
                  }}
                  onAltChange={(avatarDescription) => {
                    clearError('avatarDescription')
                    change({ avatarDescription })
                  }}
                  onUploadingChange={(avatar) =>
                    setUploads((current) => ({ ...current, avatar }))
                  }
                />
              </Frame>
            </Section>

            <Section
              title="About you"
              description="Shown at the top of your profile."
            >
              <Frame form>
                <FormRow label="Display name" htmlFor="profileNameInput">
                  {() => (
                    <>
                      <Input
                        id="profileNameInput"
                        type="text"
                        value={draft.name}
                        maxLength={NAME_MAX_LENGTH}
                        placeholder={username}
                        aria-invalid={errors.name ? true : undefined}
                        aria-describedby={
                          errors.name ? 'profileNameError' : undefined
                        }
                        onChange={(event) => {
                          clearError('name')
                          change({ name: event.target.value })
                        }}
                      />
                      {errors.name ? (
                        <p
                          id="profileNameError"
                          role="alert"
                          className={FIELD_ERROR_CLASS}
                        >
                          {errors.name}
                        </p>
                      ) : null}
                    </>
                  )}
                </FormRow>
                <FormRow
                  label="Bio"
                  htmlFor="profileSummaryInput"
                  className="sm:items-start"
                >
                  {() => (
                    <>
                      <Textarea
                        id="profileSummaryInput"
                        rows={3}
                        value={draft.summary}
                        maxLength={SUMMARY_MAX_LENGTH}
                        placeholder="A brief description about yourself"
                        aria-invalid={errors.summary ? true : undefined}
                        aria-describedby={
                          errors.summary ? 'profileSummaryError' : undefined
                        }
                        onChange={(event) => {
                          clearError('summary')
                          change({ summary: event.target.value })
                        }}
                      />
                      {errors.summary ? (
                        <p
                          id="profileSummaryError"
                          role="alert"
                          className={FIELD_ERROR_CLASS}
                        >
                          {errors.summary}
                        </p>
                      ) : null}
                    </>
                  )}
                </FormRow>
                <FormRow
                  label="Handle"
                  htmlFor="profileHandleInput"
                  hint="Your address on the fediverse. It can’t be changed."
                >
                  {({ describedBy }) => (
                    <Input
                      id="profileHandleInput"
                      aria-describedby={describedBy}
                      value={handle}
                      disabled
                    />
                  )}
                </FormRow>
              </Frame>
            </Section>

            <Section
              title="Profile fields"
              description="Up to 4, like a website, pronouns or where you are. Shown on your profile and on other servers."
              headingId="profileFieldsHeading"
            >
              <Frame form>
                <div className="px-4 py-2.5">
                  <ProfileFieldsField
                    fields={savedFields}
                    profileUrl={profileUrl}
                    labelledBy="profileFieldsHeading"
                    tags={tags}
                    showPreview={false}
                    showLinkChecks
                    pendingValues={pendingLinks}
                    onRowsChange={handleRowsChange}
                  />
                  {errors.fields ? (
                    <p role="alert" className={FIELD_ERROR_CLASS}>
                      {errors.fields}
                    </p>
                  ) : null}
                </div>
              </Frame>
            </Section>
          </form>

          {/* Outside the form: adding and removing a hashtag saves at once,
              and its add bar is a form of its own. */}
          <FeaturedTagsSection
            actorId={actorId}
            disabled={actorChanged}
            onActorChanged={handleActorChanged}
          />

          <Section
            title="Profile tabs"
            description="Posts is always shown. Choose which other tabs visitors see."
          >
            <Frame form>
              {TAB_ROWS.map((row) => (
                <FormRow
                  key={row.key}
                  label={row.label}
                  htmlFor={`${row.key}Switch`}
                  hint={'hint' in row ? row.hint : undefined}
                  inline
                >
                  {({ describedBy }) => (
                    <Switch
                      id={`${row.key}Switch`}
                      aria-label={`Show ${row.label} tab`}
                      aria-describedby={describedBy}
                      checked={draft[row.key]}
                      onCheckedChange={(checked) =>
                        change({ [row.key]: checked } as Partial<ProfileDraft>)
                      }
                    />
                  )}
                </FormRow>
              ))}
              <p className="text-muted-foreground flex items-start gap-2 px-4 pt-1 pb-2.5 text-xs">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Hiding a tab only hides it on your profile. Posts keep their
                  own visibility. To hide locations, use{' '}
                  <Link
                    href="/fitness/privacy"
                    className="text-primary-text underline underline-offset-2"
                  >
                    Fitness privacy
                  </Link>{' '}
                  or{' '}
                  <Link
                    href="/gallery/privacy"
                    className="text-primary-text underline underline-offset-2"
                  >
                    Gallery privacy
                  </Link>
                  .
                </span>
              </p>
            </Frame>
          </Section>

          <Frame className="sticky bottom-0 z-10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:hidden">
            {saveBar}
          </Frame>
        </div>

        <div className="hidden xl:sticky xl:top-4 xl:block">
          <ProfilePreview draft={draft} username={username} handle={handle} />
        </div>
      </div>

      {toastId !== null ? (
        <ProfileSavedToast id={toastId} onDismiss={dismissToast} />
      ) : null}

      <ConfirmDialog
        open={question}
        title="Discard changes?"
        description={`You changed ${describeChanges(changedKeys)}. They haven’t been saved.`}
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        destructive
        onCancel={() => {
          setConfirmingCancel(false)
          guard.keepEditing()
        }}
        onConfirm={() => {
          if (guard.pending) {
            guard.discard()
          } else {
            setConfirmingCancel(false)
            leave()
          }
        }}
      />
    </div>
  )
}
