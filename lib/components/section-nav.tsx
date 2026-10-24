'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, ReactNode, useId } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { SECTION_STICKY_TOP_CLASS } from '@/lib/components/layout/chromeLayout'
import {
  PageHeader,
  PageHeaderSectionProvider
} from '@/lib/components/page-header'
import { resolveActiveSectionUrl } from '@/lib/components/sectionNavActive'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { cn } from '@/lib/utils'

export interface SectionNavItem {
  name: string
  url: string
  /**
   * A rendered element (`<Sun />`, an avatar), not a component, so a server
   * layout can pass the list straight to these client components. Colour comes
   * from the row: lucide icons draw in `currentColor`.
   */
  icon: ReactNode
  /** One line under the name on the desktop index cards. */
  description?: string
  /** A second line under the name in the rail (the profile's handle). */
  hint?: string
}

export interface SectionNavGroup {
  /** The small label above the group; a group without one is a plain run. */
  heading?: string
  items: SectionNavItem[]
  /**
   * Only in the rail: the index page renders this group itself (Settings'
   * profile card).
   */
  railOnly?: boolean
  /**
   * On the index, after the footer card instead of before it (Settings'
   * Delete this profile, the last thing on the list page).
   */
  afterFooter?: boolean
}

export interface SectionNavFooter {
  /** The index's label above the card ("Shared across your profiles"). */
  heading: string
  /** The card's second line in the rail; the heading when absent. */
  hint?: string
  item: SectionNavItem
}

const ICON_CLASS = 'flex shrink-0 items-center [&>svg]:size-4'

/**
 * The section list ("rail") beside a settings-style page from `lg` up: groups
 * of links under small headings, the active row in the 10% orange wash, and a
 * cross-link card at the foot.
 */
export const SectionNav: FC<{
  label: string
  groups: SectionNavGroup[]
  footer?: SectionNavFooter
  className?: string
}> = ({ label, groups, footer, className }) => {
  const pathname = usePathname()
  const id = useId()
  const activeUrl = resolveActiveSectionUrl(
    pathname,
    groups.flatMap((group) => group.items.map((item) => item.url))
  )

  return (
    <nav aria-label={label} className={cn('flex flex-col gap-4', className)}>
      {groups.map((group, index) => {
        const headingId = `${id}-${index}`
        return (
          <div
            key={group.heading ?? group.items[0]?.url}
            role={group.heading ? 'group' : undefined}
            aria-labelledby={group.heading ? headingId : undefined}
          >
            {group.heading && (
              <p
                id={headingId}
                className="px-3 pb-1 text-xs font-medium text-muted-foreground"
              >
                {group.heading}
              </p>
            )}
            <ul>
              {group.items.map((item) => {
                const isActive = item.url === activeUrl
                return (
                  <li key={item.url}>
                    <Link
                      href={item.url}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        item.hint && 'py-1.5',
                        isActive
                          ? 'bg-primary/10 text-primary-text'
                          : 'hover:bg-muted'
                      )}
                    >
                      <span
                        className={cn(
                          ICON_CLASS,
                          isActive ? 'text-primary' : 'text-muted-foreground'
                        )}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{item.name}</span>
                        {item.hint && (
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {item.hint}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {footer && (
        <div className="border-t pt-4">
          <Link
            href={footer.item.url}
            className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className={cn(ICON_CLASS, 'text-primary')}>
              {footer.item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium [overflow-wrap:anywhere]">
                {footer.item.name}
              </span>
              {/* The rail says who it is for; the index's card says what
                  is in it. */}
              <span className="block text-xs text-muted-foreground">
                {footer.hint ?? footer.heading}
              </span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
        </div>
      )}
    </nav>
  )
}

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
                ICON_CLASS,
                accent ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium [overflow-wrap:anywhere] max-lg:font-normal lg:text-sm">
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
 * desktop, one component at every width. Groups that are not `railOnly`
 * render in order, then the footer card, then the `afterFooter` groups; from
 * `lg` up the first block fills the left column and the rest stack on the
 * right.
 */
export const SectionIndex: FC<{
  groups: SectionNavGroup[]
  footer?: SectionNavFooter
}> = ({ groups, footer }) => {
  const listed = groups.filter((group) => !group.railOnly)
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

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-x-4">
      <div className="space-y-6">{blocks.slice(0, 1)}</div>
      <div className="space-y-6">{blocks.slice(1)}</div>
    </div>
  )
}

interface SectionLayoutProps {
  /** The section's name: the nav landmark's label and "Back to …". */
  label: string
  title: ReactNode
  description?: ReactNode
  /**
   * The index route; the rail and the Back row are hidden there. A section
   * without one (Admin, whose root is its Overview page) has no Back row.
   */
  indexUrl?: string
  /**
   * Below `lg`, in place of the Back row: Admin keeps its dropdown there.
   */
  mobileNav?: ReactNode
  groups: SectionNavGroup[]
  footer?: SectionNavFooter
  children: ReactNode
}

/**
 * The chrome of a settings-style section (Settings, Account & security,
 * Admin): the sticky section header, the wider `--container-section` column
 * (the `[data-section-layout]` hook in the (timeline) layout), the rail from
 * `lg` up, and below `lg` either `mobileNav` (Admin's dropdown) or a
 * "Back to …" row on every page but the index, which renders `SectionIndex`
 * after the page. Fitness and Gallery are content sections and keep
 * `SectionNavDropdown`.
 */
export const SectionLayout: FC<SectionLayoutProps> = ({
  label,
  title,
  description,
  indexUrl,
  groups,
  footer,
  mobileNav,
  children
}) => {
  const isIndex = usePathname() === indexUrl
  // A section with an index opens its pages on the Back row below `md`; one
  // without (Admin) keeps its header box and dropdown there.
  const headerOnPhone = isIndex || !indexUrl

  return (
    <div data-section-layout="">
      {/* Below `md` the compact bar names the section; the header box with
          its "For @handle" line shows only on the index there, so a section
          page opens on its Back row. */}
      <PageHeader
        title={title}
        description={description}
        className={headerOnPhone ? undefined : 'max-md:hidden'}
      />
      <PageHeaderSectionProvider>
        <div
          className={cn(
            'flex w-full gap-6 pt-6 xl:gap-8',
            headerOnPhone ? 'max-md:pt-0' : 'max-md:pt-2'
          )}
        >
          {!isIndex && (groups.length > 0 || footer) && (
            <SectionNav
              label={label}
              groups={groups}
              footer={footer}
              // SECTION_STICKY_TOP_CLASS (103px): the 79px section header plus
              // the 24px gap above the rail, so it sticks where it already
              // sits; it scrolls on its own on a short viewport instead of
              // losing its foot.
              className={cn(
                'sticky max-h-[calc(100dvh-103px-1.5rem)] w-[200px] shrink-0 self-start overflow-y-auto max-lg:hidden xl:w-[216px]',
                SECTION_STICKY_TOP_CLASS
              )}
            />
          )}
          <div className="min-w-0 flex-1">
            {mobileNav ? <div className="lg:hidden">{mobileNav}</div> : null}
            {!isIndex && !mobileNav && indexUrl && (
              <BackLink
                href={indexUrl}
                label={`Back to ${label}`}
                accessibleName={`Back to ${label.toLowerCase()}`}
                className="mb-4 min-h-11 gap-2 text-sm font-medium lg:hidden"
                iconClassName="size-4"
              />
            )}
            {children}
            {isIndex && (
              <div className="mt-6">
                <SectionIndex groups={groups} footer={footer} />
              </div>
            )}
          </div>
        </div>
      </PageHeaderSectionProvider>
    </div>
  )
}
