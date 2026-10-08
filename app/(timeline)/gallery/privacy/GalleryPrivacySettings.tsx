'use client'

import { Camera, Globe, Images, MapPin } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { getGallerySettings, updateGallerySettings } from '@/lib/client'
import {
  PrivacyLocationInput,
  PrivacyLocationsCopy,
  PrivacyLocationsEditor,
  PrivacyLocationsSaveError
} from '@/lib/components/privacy-locations/PrivacyLocationsEditor'
import {
  GallerySettingsStatus,
  ToggleRow,
  useGallerySettingsForm
} from '@/lib/components/settings/gallerySettingsForm'
import { Label } from '@/lib/components/ui/label'
import { Select } from '@/lib/components/ui/select'
import { parseGalleryHiddenLocations } from '@/lib/services/gallery/hiddenLocations'
import {
  GALLERY_DEFAULTS,
  type GalleryDefault,
  type GallerySettings,
  MEDIA_PLACE_PRECISIONS,
  type MediaPlacePrecision
} from '@/lib/types/database/gallery'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

type SettingKey = keyof Pick<
  GallerySettings,
  | 'defaultPlacePrecision'
  | 'galleryDefault'
  | 'showGear'
  | 'mapPublic'
  | 'lifeListPublic'
>

const PRECISION_LABELS: Record<MediaPlacePrecision, string> = {
  hidden: 'Hidden',
  country: 'Country',
  area: 'Area (about 5 km)',
  exact: 'Exact'
}

const GALLERY_DEFAULT_LABELS: Record<GalleryDefault, string> = {
  subject: 'When it has a subject',
  always: 'Always',
  never: 'Never'
}

const HIDDEN_LOCATIONS_COPY: PrivacyLocationsCopy = {
  saved: 'Hidden locations saved.',
  cleared: 'Hidden locations cleared.',
  saveFailed: 'Failed to save hidden locations',
  saveButton: 'Save hidden locations',
  hideRadiusHelp:
    'Photos and videos taken inside this area never show a place to other people, at any precision. You still see them with their place.'
}

const loadHiddenLocations = async (): Promise<PrivacyLocationInput[]> =>
  parseGalleryHiddenLocations((await getGallerySettings()).hiddenLocations)

const saveHiddenLocations = async (
  locations: PrivacyLocationInput[]
): Promise<PrivacyLocationInput[]> => {
  try {
    const saved = await updateGallerySettings({ hiddenLocations: locations })
    return parseGalleryHiddenLocations(saved.hiddenLocations)
  } catch (error) {
    throw new PrivacyLocationsSaveError(
      error instanceof Error ? error.message : HIDDEN_LOCATIONS_COPY.saveFailed
    )
  }
}

interface SelectRowProps {
  id: string
  label: string
  description: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  disabled: boolean
  busy: boolean
  onChange: (value: string) => void
}

const SelectRow: FC<SelectRowProps> = ({
  id,
  label,
  description,
  value,
  options,
  disabled,
  busy,
  onChange
}) => (
  // Stacked below `sm` (label above a full-width control): beside each other, a
  // 320px screen leaves the label a one-word column and truncates the select.
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
    <div className="min-w-0 space-y-0.5">
      <Label htmlFor={id}>{label}</Label>
      <p id={`${id}-help`} className="text-[0.8rem] text-muted-foreground">
        {description}
      </p>
    </div>
    <div className="w-full sm:w-48 sm:shrink-0">
      <Select
        id={id}
        aria-describedby={`${id}-help`}
        value={value}
        disabled={disabled}
        aria-busy={busy}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  </div>
)

interface SectionProps {
  icon: ReactNode
  title: string
  description?: string
  children: ReactNode
}

const Section: FC<SectionProps> = ({ icon, title, description, children }) => (
  <section className="space-y-4 rounded-2xl border bg-background/80 p-4 shadow-sm sm:p-6">
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {icon}
        {title}
      </h2>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {children}
  </section>
)

interface Props {
  /** Which map backend renders the hidden-locations picker. */
  mapProvider: PublicMapProvider
}

/**
 * Gallery › Privacy: where photos show on the map, which details others see,
 * and what goes in the gallery. Each control saves on its own, so a failed save
 * reverts only that control; the hidden locations use the editor Fitness's
 * privacy page shares and save with their own button.
 */
export const GalleryPrivacySettings: FC<Props> = ({ mapProvider }) => {
  const {
    settings,
    loaded,
    loadError,
    saveError,
    savedStatus,
    savingKeys,
    loadSettings,
    save
  } = useGallerySettingsForm<SettingKey>({
    saveError: 'Failed to save privacy settings. Please try again.',
    loadError: 'Failed to load privacy settings.'
  })

  return (
    <div className="space-y-6">
      <GallerySettingsStatus
        loadError={loadError}
        saveError={saveError}
        savedStatus={savedStatus}
        onRetry={loadSettings}
      />

      <Section
        icon={<MapPin aria-hidden="true" className="size-5" />}
        title="Place"
        description="How precisely a photo’s place is shown to others. Only you ever see the exact coordinates."
      >
        <SelectRow
          id="gallery-default-place-precision"
          label="Default precision for new media"
          description="You can change it on each photo. GPS is always removed from the file itself."
          value={settings?.defaultPlacePrecision ?? 'hidden'}
          options={MEDIA_PLACE_PRECISIONS.map((value) => ({
            value,
            label: PRECISION_LABELS[value]
          }))}
          disabled={!loaded}
          busy={savingKeys.has('defaultPlacePrecision')}
          onChange={(value) =>
            save('defaultPlacePrecision', value as MediaPlacePrecision)
          }
        />
      </Section>

      <Section
        icon={<Globe aria-hidden="true" className="size-5" />}
        title="Hidden locations"
        description="Media taken inside these areas never shows a place to others, at any precision."
      >
        <PrivacyLocationsEditor
          mapProvider={mapProvider}
          load={loadHiddenLocations}
          save={saveHiddenLocations}
          copy={HIDDEN_LOCATIONS_COPY}
          mapIdPrefix="gallery-hidden-locations"
        />
      </Section>

      <Section
        icon={<Camera aria-hidden="true" className="size-5" />}
        title="Gear and exposure"
      >
        <ToggleRow
          id="gallery-show-gear"
          label="Show gear and exposure on my media"
          description="Camera, lens and settings appear in the viewer and the gallery, never in the timeline."
          checked={settings?.showGear ?? false}
          disabled={!loaded}
          busy={savingKeys.has('showGear')}
          onCheckedChange={(checked) => save('showGear', checked)}
        />
      </Section>

      <Section
        icon={<Images aria-hidden="true" className="size-5" />}
        title="Gallery"
      >
        <SelectRow
          id="gallery-default"
          label="Add new photos and videos to my gallery"
          description="You can change it per item in media details."
          value={settings?.galleryDefault ?? 'subject'}
          options={GALLERY_DEFAULTS.map((value) => ({
            value,
            label: GALLERY_DEFAULT_LABELS[value]
          }))}
          disabled={!loaded}
          busy={savingKeys.has('galleryDefault')}
          onChange={(value) => save('galleryDefault', value as GalleryDefault)}
        />
        <ToggleRow
          id="gallery-map-public"
          label="Show my gallery map to others"
          description="Others see only the places you allow, at the precision you chose."
          checked={settings?.mapPublic ?? false}
          disabled={!loaded}
          busy={savingKeys.has('mapPublic')}
          onCheckedChange={(checked) => save('mapPublic', checked)}
        />
        <ToggleRow
          id="gallery-life-list-public"
          label="Let others see my life list"
          description="When off, only you see the life list and species counts."
          checked={settings?.lifeListPublic ?? false}
          disabled={!loaded}
          busy={savingKeys.has('lifeListPublic')}
          onCheckedChange={(checked) => save('lifeListPublic', checked)}
        />
      </Section>
    </div>
  )
}
