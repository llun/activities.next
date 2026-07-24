'use client'

import { FC, useEffect, useState } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Select } from '@/lib/components/ui/select'
import { MEDIA_STORAGE_ENV_PREFIX } from '@/lib/config/environmentTemplates'
import type { ResolvedServerSettings } from '@/lib/config/serverSettings'
import { MAX_CONFIGURABLE_FILE_SIZE } from '@/lib/services/medias/constants'
import type { MediaStorageBackendSummary } from '@/lib/services/medias/storageBackendSummary'

import { EnvBlockBuilder } from './EnvBlockBuilder'
import { EnvLockLabel } from './EnvLockBadge'
import type { ServerSettingLocks } from './InstanceSettingsForm'
import { NumberField } from './NumberField'
import { SaveBar } from './SaveBar'
import { SettingsField } from './SettingsField'
import { SettingsSection } from './SettingsSection'
import { useServerSettingsForm } from './useServerSettingsForm'

const BYTES_PER_MB = 1024 * 1024
const MAX_UPLOAD_MB = Math.floor(MAX_CONFIGURABLE_FILE_SIZE / BYTES_PER_MB)

interface PostsMediaSettingsFormProps {
  settings: ResolvedServerSettings
  locks: ServerSettingLocks
  // The storage backend is environment-only, so it is reported here rather than
  // edited. Resolved on the server (see describeMediaStorageBackend).
  storageBackend: MediaStorageBackendSummary
}

const POSTS_KEYS = ['posts.maxCharacters', 'posts.maxMediaAttachments']
const POLL_KEYS = [
  'polls.maxOptions',
  'polls.maxCharactersPerOption',
  'polls.minExpirationSeconds',
  'polls.maxExpirationSeconds'
]
const MEDIA_KEYS = ['media.maxFileSize']

// Post size is picked from a few well-known caps; anything else is entered
// through "Custom…", which reveals a plain number input beside the select.
const CUSTOM_POST_SIZE = 'custom'
const POST_SIZE_OPTIONS = [
  { value: '500', label: '500 characters — Mastodon default' },
  { value: '1000', label: '1,000 characters' },
  { value: '5000', label: '5,000 characters' }
]

const postSizeModeFor = (maxCharacters: number) =>
  POST_SIZE_OPTIONS.some((option) => option.value === String(maxCharacters))
    ? String(maxCharacters)
    : CUSTOM_POST_SIZE

const MIN_EXPIRATION_OPTIONS = [
  { value: '300', label: '5 minutes' },
  { value: '1800', label: '30 minutes' },
  { value: '3600', label: '1 hour' }
]
const MAX_EXPIRATION_OPTIONS = [
  { value: '604800', label: '7 days' },
  { value: '2678400', label: '1 month' },
  { value: '8035200', label: '3 months' }
]

// Keep an out-of-preset stored value selectable so the select never silently
// rewrites it.
const withCurrent = (
  options: { value: string; label: string }[],
  current: string
) =>
  options.some((option) => option.value === current)
    ? options
    : [{ value: current, label: `${current} seconds` }, ...options]

export const PostsMediaSettingsForm: FC<PostsMediaSettingsFormProps> = ({
  settings,
  locks,
  storageBackend
}) => {
  const { values, setValue, isDirty, statusFor, saveSection } =
    useServerSettingsForm({
      'posts.maxCharacters': settings.posts.maxCharacters,
      'posts.maxMediaAttachments': settings.posts.maxMediaAttachments,
      'polls.maxOptions': settings.polls.maxOptions,
      'polls.maxCharactersPerOption': settings.polls.maxCharactersPerOption,
      'polls.minExpirationSeconds': settings.polls.minExpirationSeconds,
      'polls.maxExpirationSeconds': settings.polls.maxExpirationSeconds,
      'media.maxFileSize': settings.media.maxFileSize
    })

  // The picked mode is its own state, never derived from the current value:
  // deriving it would re-evaluate on every keystroke and unmount the custom
  // input as soon as a half-typed number passed through a preset.
  const [selectedPostSizeMode, setSelectedPostSizeMode] = useState(() =>
    postSizeModeFor(settings.posts.maxCharacters)
  )

  const lock = (key: string) => locks[key] ?? { locked: false }
  const postsStatus = statusFor('posts')
  const pollsStatus = statusFor('polls')
  const mediaStatus = statusFor('media')

  const maxCharacters = values['posts.maxCharacters'] as number
  const uploadBytes = values['media.maxFileSize'] as number

  // A preset stays picked only while the value still matches it: saving adopts
  // the server-resolved value, which can land somewhere else entirely. When it
  // does, re-derive from the value rather than always dropping to Custom, so a
  // value that is itself a preset shows as that preset.
  const resolvePostSizeMode = (mode: string) =>
    mode === CUSTOM_POST_SIZE || mode === String(maxCharacters)
      ? mode
      : postSizeModeFor(maxCharacters)

  const postSizeMode = resolvePostSizeMode(selectedPostSizeMode)

  // Commit that, don't just render it. An orphaned preset left in state would
  // match again the moment the value drifted back to it — flipping the select
  // and unmounting the input while it was being typed into. Custom
  // short-circuits, so this never fires during an edit.
  // resolvePostSizeMode is re-created every render, but it only reads
  // maxCharacters — the dependency below — so the closure is never stale.
  useEffect(() => {
    setSelectedPostSizeMode(resolvePostSizeMode)
  }, [maxCharacters])

  const changePostSizeMode = (mode: string) => {
    setSelectedPostSizeMode(mode)
    if (mode !== CUSTOM_POST_SIZE) setValue('posts.maxCharacters', Number(mode))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Posts & media"
        description="Limits for posts, polls, and uploads, plus the storage and map backends behind them. Limits are advertised via the instance API so apps follow along."
      />

      <SettingsSection
        title="Posts"
        description="Limits for new posts, advertised to apps via the instance API."
        footer={
          <SaveBar
            dirty={isDirty(POSTS_KEYS)}
            saving={postsStatus.saving}
            saved={postsStatus.saved}
            error={postsStatus.error}
            onSave={() => saveSection('posts', POSTS_KEYS)}
          />
        }
      >
        <SettingsField
          label="Post size"
          htmlFor="posts-max-characters"
          help={`New posts and edits are capped at ${maxCharacters.toLocaleString()} characters. Links always count as 23.`}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Select
              id="posts-max-characters"
              value={postSizeMode}
              onChange={(event) => changePostSizeMode(event.target.value)}
            >
              {POST_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value={CUSTOM_POST_SIZE}>Custom…</option>
            </Select>
            {postSizeMode === CUSTOM_POST_SIZE && (
              <NumberField
                id="posts-max-characters-custom"
                ariaLabel="Custom post size"
                value={maxCharacters}
                min={1}
                suffix="characters"
                onChange={(next) => setValue('posts.maxCharacters', next)}
              />
            )}
          </div>
        </SettingsField>

        <SettingsField
          label="Media per post"
          htmlFor="posts-max-media"
          help="Up to 20. The fediverse still only ever sees the first 4."
        >
          <NumberField
            id="posts-max-media"
            value={values['posts.maxMediaAttachments'] as number}
            min={1}
            max={20}
            suffix="attachments"
            onChange={(next) => setValue('posts.maxMediaAttachments', next)}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection
        title="Polls"
        description="Shape of polls people can attach to posts."
        footer={
          <SaveBar
            dirty={isDirty(POLL_KEYS)}
            saving={pollsStatus.saving}
            saved={pollsStatus.saved}
            error={pollsStatus.error}
            onSave={() => saveSection('polls', POLL_KEYS)}
          />
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField label="Choices per poll" htmlFor="polls-max-options">
            <NumberField
              id="polls-max-options"
              value={values['polls.maxOptions'] as number}
              min={2}
              max={50}
              suffix="choices"
              onChange={(next) => setValue('polls.maxOptions', next)}
            />
          </SettingsField>

          <SettingsField
            label="Characters per choice"
            htmlFor="polls-max-chars"
          >
            <NumberField
              id="polls-max-chars"
              value={values['polls.maxCharactersPerOption'] as number}
              min={1}
              suffix="characters"
              onChange={(next) =>
                setValue('polls.maxCharactersPerOption', next)
              }
            />
          </SettingsField>

          <SettingsField label="Shortest duration" htmlFor="polls-min-expiry">
            <Select
              id="polls-min-expiry"
              value={String(values['polls.minExpirationSeconds'])}
              onChange={(event) =>
                setValue(
                  'polls.minExpirationSeconds',
                  Number(event.target.value)
                )
              }
            >
              {withCurrent(
                MIN_EXPIRATION_OPTIONS,
                String(values['polls.minExpirationSeconds'])
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label="Longest duration" htmlFor="polls-max-expiry">
            <Select
              id="polls-max-expiry"
              value={String(values['polls.maxExpirationSeconds'])}
              onChange={(event) =>
                setValue(
                  'polls.maxExpirationSeconds',
                  Number(event.target.value)
                )
              }
            >
              {withCurrent(
                MAX_EXPIRATION_OPTIONS,
                String(values['polls.maxExpirationSeconds'])
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Media"
        description="Upload policy. The storage backend itself is infrastructure and stays in the environment."
        footer={
          <SaveBar
            dirty={isDirty(MEDIA_KEYS)}
            saving={mediaStatus.saving}
            saved={mediaStatus.saved}
            error={mediaStatus.error}
            onSave={() => saveSection('media', MEDIA_KEYS)}
          />
        }
      >
        <SettingsField
          label="Upload size limit"
          htmlFor="media-max-file-size"
          help={`Applies to images and video alike; existing media is never touched. Up to ${MAX_UPLOAD_MB.toLocaleString()} MB.`}
          locked={lock('media.maxFileSize').locked}
          envVar={lock('media.maxFileSize').envVar}
        >
          <NumberField
            id="media-max-file-size"
            value={Math.round(uploadBytes / BYTES_PER_MB)}
            min={1}
            // The object-storage driver buffers a stored object back out at the
            // same resolved cap, so raising this stays consistent with the read
            // path; the ceiling is what keeps that buffer bounded. See the
            // media.maxFileSize field in lib/config/serverSettings.
            max={MAX_UPLOAD_MB}
            suffix="MB per file"
            disabled={lock('media.maxFileSize').locked}
            onChange={(next) =>
              setValue('media.maxFileSize', Math.round(next * BYTES_PER_MB))
            }
          />
        </SettingsField>

        <SettingsField
          label={
            <EnvLockLabel envVar={MEDIA_STORAGE_ENV_PREFIX}>
              Storage backend
            </EnvLockLabel>
          }
          help="Read from the environment at boot — change it with the builder below, not here."
        >
          <p className="py-1 text-sm font-medium">
            {storageBackend.label}
            {storageBackend.detail && (
              <span className="font-normal text-muted-foreground">
                {' '}
                ({storageBackend.detail})
              </span>
            )}
          </p>
        </SettingsField>
      </SettingsSection>

      <EnvBlockBuilder />
    </div>
  )
}
