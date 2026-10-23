'use client'

import { Info } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useCallback, useMemo, useRef, useState } from 'react'

import { ApiRequestError, updateProfile } from '@/lib/client'
import type { CustomEmojiTextProps } from '@/lib/components/actors/ActorDisplayName'
import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { ConfirmDialog } from '@/lib/components/photo-editor/ConfirmDialog'
import { ProfileFieldsField } from '@/lib/components/settings/ProfileFieldsField'
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
  toDraft
} from './profileDraft'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'

interface Props {
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
  profile,
  username,
  handle,
  profileUrl,
  profilePath,
  tags
}) => {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [saved, setSaved] = useState(profile)
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile))
  const [pendingLinks, setPendingLinks] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<
    Partial<Record<ProfileFieldName, string>>
  >({})
  const [toastId, setToastId] = useState<number | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  const changedKeys = getChangedKeys(draft, saved)
  const dirty = changedKeys.length > 0
  const guard = useUnsavedChangesGuard(dirty)

  const change = useCallback(
    (changes: Partial<ProfileDraft>) =>
      setDraft((current) => ({ ...current, ...changes })),
    []
  )
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

  const handleSave = async () => {
    if (saving || !dirty) return
    // The link rows block a half-filled row through the browser's own checks.
    if (formRef.current && !formRef.current.reportValidity()) return
    setSaving(true)
    setErrors({})
    try {
      const result = await updateProfile(buildProfilePatch(draft, saved))
      setPendingLinks(getPendingLinkValues(saved, result))
      setSaved(result)
      // The server's copy is the truth (it trims the alt texts); the link rows
      // keep what the field holds, which compares equal after trimming.
      setDraft((current) => ({ ...toDraft(result), fields: current.fields }))
      setToastId((current) => (current ?? 0) + 1)
      router.refresh()
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to save profile'
      const field =
        error instanceof ApiRequestError && error.status === 422
          ? getErrorField(message)
          : 'form'
      setErrors({ [field]: message })
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
  const question = confirmingCancel || guard.pendingHref !== null

  const saveBar = (
    <SaveBar
      dirty={dirty}
      saving={saving}
      saved={false}
      dirtyLabel="You have unsaved changes"
      actionLabel="Save changes"
      onSave={handleSave}
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
        {toastId !== null
          ? `${PROFILE_SAVED_TITLE}. ${PROFILE_SAVED_MESSAGE}`
          : ''}
      </div>

      {/* Phones: Cancel, the title and Save in one bar at the top. */}
      <div
        data-slot="profile-editor-phone-bar"
        className="flex items-center justify-between gap-2 md:hidden"
      >
        <Button type="button" variant="ghost" onClick={handleCancel}>
          Cancel
        </Button>
        <h2 className="text-base font-semibold">Edit profile</h2>
        <Button type="button" disabled={!dirty || saving} onClick={handleSave}>
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

      {errors.form ? (
        <Alert title="Couldn’t save your profile">{errors.form}</Alert>
      ) : null}

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start xl:gap-8">
        <div className="min-w-0 space-y-6">
          <form
            ref={formRef}
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
          <FeaturedTagsSection variant="embedded" />

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
          if (guard.pendingHref !== null) {
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
