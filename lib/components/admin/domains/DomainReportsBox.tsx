import Link from 'next/link'
import { FC } from 'react'

import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'

interface Props {
  domain: string
  openReports: number
  /** The count hit the query's cap: show it as "<n>+". */
  capped?: boolean
}

/**
 * The domain page's Reports box: how many reports about profiles on this domain
 * are open, and a link to the reports list filtered to it. Reports stay in one
 * queue for the whole server.
 */
export const DomainReportsBox: FC<Props> = ({
  domain,
  openReports,
  capped = false
}) => {
  const count = capped ? `${openReports}+` : `${openReports}`
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span
          aria-hidden="true"
          className="bg-primary/10 text-primary-text flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-1.5 text-sm font-semibold tabular-nums"
        >
          {count}
        </span>
        <div className="min-w-[8.5rem] flex-1 text-sm break-words">
          <p className="font-medium">
            {openReports === 0
              ? 'No open reports about profiles on '
              : `${count} open ${openReports === 1 ? 'report' : 'reports'} about profiles on `}
            <span className="wrap-anywhere">{domain}</span>
          </p>
          <p className="text-muted-foreground">
            Moderators see every domain’s reports.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/reports?domain=${encodeURIComponent(domain)}`}>
            View reports
          </Link>
        </Button>
      </div>
    </Frame>
  )
}
