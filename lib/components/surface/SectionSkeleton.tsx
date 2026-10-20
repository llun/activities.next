import { FC } from 'react'

import { cn } from '@/lib/utils'

import { Frame } from './Frame'
import { SkeletonBar } from './Skeleton'

interface Props {
  /**
   * One entry per section: how many rows its frame holds. `[3, 2]` draws two
   * sections, the first with three rows. An entry that is itself an array is
   * ONE form box of `FormGroup`s (General, Preferences): a heading bar inside
   * the box per group, with that many rows, and a Save bar footer, with no
   * section heading above it. Such an entry is always drawn in the form look.
   */
  sections?: (number | number[])[]
  /**
   * Indexes (into `sections`) of numeric sections whose rows each hold a tall
   * control, such as a 16-row Markdown textarea, instead of a one-line input:
   * their rows draw a control of that height so the sections below do not jump
   * when the content arrives.
   */
  tallSections?: number[]
  /**
   * Draw the numeric sections in the form look (a `Frame form`: no hairlines,
   * rows spaced like `FormRow`, `py-2.5`) instead of as a divided list. Turn it
   * on for a page of settings forms; leave it off for lists.
   */
  form?: boolean
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

const Row: FC<{ form: boolean; tall?: boolean }> = ({ form, tall = false }) => (
  <div
    className={cn(
      'flex justify-between gap-6 px-4',
      tall ? 'items-start' : 'items-center',
      form ? 'py-2.5' : 'py-4'
    )}
  >
    <div className="min-w-0 flex-1 space-y-2">
      <SkeletonBar className="h-4 w-40 max-w-full" />
      <SkeletonBar className="h-3 w-64 max-w-full" />
    </div>
    <SkeletonBar
      className={cn(
        'shrink-0',
        tall ? 'h-[22rem] w-24 sm:w-48' : 'h-9 w-24 sm:w-48'
      )}
    />
  </div>
)

/**
 * The shape of a section route while it loads, for a `loading.tsx`: the page's
 * title line, then each `Section` as a heading bar and a `Frame` outline with
 * its rows, so the page does not jump when the content arrives. Draws no text;
 * assistive tech hears one polite "Loading".
 */
export const SectionSkeleton: FC<Props> = ({
  sections = [3],
  tallSections = [],
  form = false,
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
    {sections.map((rows, section) =>
      Array.isArray(rows) ? (
        // One box of `FormGroup`s with its Save footer: no section heading.
        <Frame key={section} form footer={<SkeletonBar className="h-9 w-20" />}>
          {rows.map((groupRows, group) => (
            <div key={group}>
              {/* `FormGroup`'s heading block: `px-4 pt-5 pb-0.5`, `pt-2.5` first. */}
              <div
                className={cn('px-4 pb-0.5', group === 0 ? 'pt-2.5' : 'pt-5')}
              >
                <div className="flex h-6 items-center">
                  <SkeletonBar className="h-5 w-28" />
                </div>
                {descriptions ? (
                  <div className="mt-0.5 flex h-5 items-center">
                    <SkeletonBar className="h-4 w-56 max-w-full" />
                  </div>
                ) : null}
              </div>
              {Array.from({ length: groupRows }, (_, row) => (
                <Row key={row} form />
              ))}
            </div>
          ))}
        </Frame>
      ) : (
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
          <Frame form={form} divided={!form}>
            {Array.from({ length: rows }, (_, row) => (
              <Row
                key={row}
                form={form}
                tall={tallSections.includes(section)}
              />
            ))}
          </Frame>
        </div>
      )
    )}
  </div>
)
