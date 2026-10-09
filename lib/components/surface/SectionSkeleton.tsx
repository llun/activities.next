import { FC } from 'react'

import { cn } from '@/lib/utils'

import { Frame } from './Frame'
import { SkeletonBar } from './Skeleton'

interface Props {
  /**
   * One entry per section: how many rows its frame holds. `[3, 2]` draws two
   * sections, the first with three rows.
   */
  sections?: number[]
  /** Draw the child page's own title and description above the sections. */
  title?: boolean
  /**
   * Draw each section's heading bars above its frame (the default). A page
   * whose list sits straight under the title, with no heading of its own, turns
   * it off.
   */
  headings?: boolean
  /**
   * Draw the muted description line under each heading bar (the default). A
   * heading with no description of its own turns it off.
   */
  descriptions?: boolean
  /** What a screen reader hears while it loads (default "Loading"). */
  label?: string
  className?: string
}

/**
 * The shape of a section route while it loads, for a `loading.tsx`: the page's
 * title line, then each `Section` as a heading bar and a `Frame` outline with
 * its rows, so the page does not jump when the content arrives. Draws no text;
 * assistive tech hears one polite "Loading".
 */
export const SectionSkeleton: FC<Props> = ({
  sections = [3],
  title = true,
  headings = true,
  descriptions = true,
  label = 'Loading',
  className
}) => (
  <div
    role="status"
    aria-busy="true"
    data-slot="section-skeleton"
    className={cn('space-y-6', className)}
  >
    <span className="sr-only">{label}</span>
    {title ? (
      <div className="space-y-2">
        <SkeletonBar className="h-7 w-40" />
        <SkeletonBar className="h-4 w-80 max-w-full" />
      </div>
    ) : null}
    {sections.map((rows, section) => (
      <div key={section} className="space-y-3">
        {headings ? (
          // `Section`'s heading row (a 24px line) over its 20px description.
          <div className="space-y-1">
            <div className="flex h-6 items-center">
              <SkeletonBar className="h-5 w-36" />
            </div>
            {descriptions ? (
              <div className="flex h-5 items-center">
                <SkeletonBar className="h-4 w-64 max-w-full" />
              </div>
            ) : null}
          </div>
        ) : null}
        <Frame divided>
          {Array.from({ length: rows }, (_, row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-6 px-4 py-4"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-4 w-40 max-w-full" />
                <SkeletonBar className="h-3 w-64 max-w-full" />
              </div>
              <SkeletonBar className="h-9 w-24 shrink-0 sm:w-48" />
            </div>
          ))}
        </Frame>
      </div>
    ))}
  </div>
)
