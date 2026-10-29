'use client'

import { ChevronRight } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { FC, ReactNode, useId } from 'react'

import {
  PageHeader,
  PageHeaderSectionProvider
} from '@/lib/components/page-header'
import { SectionNavDropdown } from '@/lib/components/section-nav-dropdown'
import {
  SECTION_NAV_ICON_CLASS,
  type SectionNavFooter,
  type SectionNavGroup,
  type SectionNavItem,
  SectionNavItemBadge
} from '@/lib/components/section-nav-shared'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { cn } from '@/lib/utils'

export type {
  SectionNavFooter,
  SectionNavGroup,
  SectionNavItem
} from '@/lib/components/section-nav-shared'

const IndexGroup: FC<{
  heading?: string
  items: SectionNavItem[]
  accent?: boolean
}> = ({ heading, items, accent }) => {
  const id = useId()
  const Block = heading ? 'section' : 'div'
  return (
    // A headless run (Delete) is a plain block: an unnamed <section> or
    // group would only add noise for assistive tech.
    <Block {...(heading ? { 'aria-labelledby': id } : null)}>
      {heading && (
        <h2
          id={id}
          className="mb-2 px-1 text-sm font-medium text-muted-foreground"
        >
          {heading}
        </h2>
      )}
      <FramedList>
        {items.map((item) => (
          <FramedListItem
            key={item.url}
            href={item.url}
            className="flex min-h-[52px] items-center gap-3"
          >
            <span
              className={cn(
                SECTION_NAV_ICON_CLASS,
                accent ? 'text-primary' : 'text-muted-foreground',
                item.danger && 'text-destructive'
              )}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block font-medium [overflow-wrap:anywhere] max-lg:font-normal lg:text-sm',
                  item.danger && 'text-destructive'
                )}
              >
                {item.name}
              </span>
              {item.description && (
                // Phones list the names only, except the cross-link card, whose
                // line says what lives on the other side.
                <span
                  className={cn(
                    'block text-xs text-muted-foreground [overflow-wrap:anywhere]',
                    !accent && 'max-lg:hidden'
                  )}
                >
                  {item.description}
                </span>
              )}
            </span>
            <SectionNavItemBadge count={item.badge} label={item.badgeLabel} />
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </FramedListItem>
        ))}
      </FramedList>
    </Block>
  )
}

/**
 * The section's index: the list page on phones and the described cards on
 * desktop, one component at every width. Groups that are not `menuOnly`
 * render in order, then the footer card, then the `afterFooter` groups, in
 * one column capped at 680px.
 */
export const SectionIndex: FC<{
  groups: SectionNavGroup[]
  footer?: SectionNavFooter
}> = ({ groups, footer }) => {
  const listed = groups.filter((group) => !group.menuOnly)
  const toBlock = (group: SectionNavGroup) => (
    <IndexGroup
      key={group.heading ?? group.items[0]?.url}
      heading={group.heading}
      items={group.items}
    />
  )
  const blocks = [
    ...listed.filter((group) => !group.afterFooter).map(toBlock),
    ...(footer
      ? [
          <IndexGroup
            key="footer"
            heading={footer.heading}
            items={[footer.item]}
            accent
          />
        ]
      : []),
    ...listed.filter((group) => group.afterFooter).map(toBlock)
  ]

  return <div className="flex max-w-[680px] flex-col gap-6">{blocks}</div>
}

interface SectionLayoutProps {
  /** The section's name: the nav landmark's label and the list-page link's text. */
  label: string
  /** The list-page link's text below `md` when `label` is long ("Account" for "Account & security"). */
  shortLabel?: string
  title: ReactNode
  description?: ReactNode
  /**
   * The index route: no dropdown row there, and the row's list-page link
   * elsewhere. A section without one has no index and no link.
   */
  indexUrl?: string
  groups: SectionNavGroup[]
  footer?: SectionNavFooter
  children: ReactNode
}

/**
 * The chrome of a settings-style section (Settings, Account & security,
 * Admin): the sticky section header; on every page but the index the shared
 * section row (a link to the index, then the section dropdown); on the index,
 * `SectionIndex` after the page. Fitness and Gallery render
 * `SectionNavDropdown` themselves and have no index.
 */
export const SectionLayout: FC<SectionLayoutProps> = ({
  label,
  shortLabel,
  title,
  description,
  indexUrl,
  groups,
  footer,
  children
}) => {
  const pathname = usePathname()
  const isIndex = pathname === indexUrl
  const hasItems = groups.some((group) => group.items.length > 0)

  return (
    <>
      {/* Below `md` the compact bar names the section; the header box with its
          "For @handle" line shows only on the index there, except in a section
          without an index (a signed-out Account), which keeps its header box. */}
      <PageHeader
        title={title}
        description={description}
        className={indexUrl && !isIndex ? 'max-md:hidden' : undefined}
      />
      <PageHeaderSectionProvider>
        <div
          className={cn(
            'w-full',
            isIndex || !indexUrl ? 'pt-6 max-md:pt-0' : 'pt-4 max-md:pt-3'
          )}
        >
          {!isIndex && hasItems && (
            <SectionNavDropdown
              label={label}
              shortLabel={shortLabel}
              groups={groups}
              footer={footer}
              indexUrl={indexUrl}
            />
          )}
          {children}
          {isIndex && (
            // The top margin only when the page above rendered something: a
            // page that returns null leaves this wrapper the column's first
            // child, so the list sits flush under the header.
            <div className="[&:not(:first-child)]:mt-6">
              <SectionIndex groups={groups} footer={footer} />
            </div>
          )}
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}
