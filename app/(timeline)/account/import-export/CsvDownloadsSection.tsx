import { Download } from 'lucide-react'

import { csvExportUrl } from '@/lib/client/bulkImports'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'

interface Props {
  actorId: string
}

const DOWNLOADS = [
  { file: 'following_accounts.csv', label: 'Following' },
  { file: 'lists.csv', label: 'Lists' },
  { file: 'muted_accounts.csv', label: 'Muted accounts' },
  { file: 'blocked_accounts.csv', label: 'Blocked accounts' },
  { file: 'blocked_domains.csv', label: 'Blocked domains' },
  { file: 'bookmarks.csv', label: 'Bookmarks' }
] as const

export const CsvDownloadsSection = ({ actorId }: Props) => (
  <Section
    title="Spreadsheet downloads"
    description="Mastodon-compatible CSV files, one list at a time. Followers are in the archive only, as Mastodon has no file for them."
  >
    <Frame divided>
      {DOWNLOADS.map(({ file, label }) => (
        <div
          key={file}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-sm text-muted-foreground">{file}</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <a
              href={csvExportUrl(file, actorId)}
              aria-label={`Download CSV (${label})`}
            >
              <Download aria-hidden="true" />
              Download CSV
            </a>
          </Button>
        </div>
      ))}
    </Frame>
  </Section>
)
