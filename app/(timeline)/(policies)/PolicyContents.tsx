import { ChevronDown } from 'lucide-react'

import { Frame } from '@/lib/components/surface/Frame'
import type { PolicyHeading } from '@/lib/utils/text/renderPolicyMarkdown'

const linkClass =
  'text-foreground flex min-w-0 gap-2 rounded-sm no-underline hover:underline focus-visible:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

/** A document's native fragment links, with no client state or sticky chrome. */
export const PolicyContents = ({ headings }: { headings: PolicyHeading[] }) => {
  if (headings.length < 3) return null

  const items = headings.map(({ id, text }, index) => (
    <li key={id} className="break-inside-avoid">
      <a href={`#${id}`} className={linkClass}>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {index + 1}.
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
      </a>
    </li>
  ))

  return (
    <>
      <nav aria-label="On this page" className="mt-6 max-md:hidden">
        <Frame muted className="px-5 py-4">
          <p className="text-muted-foreground text-[13px] font-semibold tracking-wide uppercase">
            On this page
          </p>
          <ol className="mt-2 columns-2 gap-7 text-[15px] leading-[22px] [&_a]:py-1">
            {items}
          </ol>
        </Frame>
      </nav>
      <nav aria-label="On this page" className="mt-5 md:hidden">
        <Frame muted>
          <details className="group">
            <summary className="focus-visible:ring-ring flex min-h-[46px] cursor-pointer list-none items-center gap-2 rounded-lg px-5 py-3 text-sm focus-visible:ring-2 focus-visible:outline-hidden [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">On this page</span>
              <span className="text-muted-foreground ml-auto">
                {headings.length} sections
              </span>
              <ChevronDown
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
              />
            </summary>
            <ol className="border-t px-5 py-2 text-[15px] leading-[22px] [&_a]:min-h-10 [&_a]:py-2">
              {items}
            </ol>
          </details>
        </Frame>
      </nav>
    </>
  )
}
