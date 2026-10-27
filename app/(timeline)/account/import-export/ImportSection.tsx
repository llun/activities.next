import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { formatBytes } from '@/lib/utils/formatBytes'

interface Props {
  actorId: string
  handle: string
  currentTime: number
  initialImport: unknown | null
  maxImportBytes: number
  maxCsvBytes: number
}

/** Placeholder for the archive and CSV import controls added in slice 2. */
export const ImportSection = ({ maxImportBytes, maxCsvBytes }: Props) => (
  <Section
    title="Import"
    description="Bring in an archive or a list from activities.next or Mastodon."
  >
    <Frame className="p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">
        Import controls are coming soon. Archives can be up to{' '}
        {formatBytes(maxImportBytes)} and CSV files up to{' '}
        {formatBytes(maxCsvBytes)}.
      </p>
    </Frame>
  </Section>
)
