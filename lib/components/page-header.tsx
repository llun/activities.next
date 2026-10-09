'use client'

import { ReactNode, createContext, useContext } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { breakoutStyle } from '@/lib/components/layout/chromeLayout'
import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { useMobileNavigation } from '@/lib/components/layout/mobile-navigation-context'
import { cn } from '@/lib/utils'

export interface PageHeaderBack {
  /** The parent route Back returns to. */
  href: string
  /** Names the destination, e.g. "Back to lists"; contains `label`. */
  accessibleName: string
  /** Visible text; "Back" unless the destination is a profile. */
  label?: string
  /** `false` for a per-user `[actor]` route. */
  prefetch?: boolean
}

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  stackActionsOnMobile?: boolean
  bottomSlot?: ReactNode
  /**
   * A parent-route Back. Below `md` it is a labelled row at the top of the
   * content; from `md` up it is the arrow beside the title it always was.
   * Not rendered in section mode: there the section layout owns the bar, and
   * a detail page renders its own `BackLink` above the section heading.
   */
  back?: PageHeaderBack
  /**
   * A short section title for the mobile bar when the page's own heading is
   * longer or more specific (a list's name, a collection's title). The page
   * heading then stays visible in the content below the bar. Not rendered in
   * section mode, where the section layout's bar carries the section name.
   */
  compactTitle?: string
  /**
   * Below `md` the content directly below meets the header's bottom edge
   * instead of the parent's vertical rhythm — the bar's hairline when the box
   * has nothing to show there, else the box's — so a full-bleed surface (the
   * home timeline's composer) has no band above it. No effect from `md` up or
   * in section mode.
   */
  flushOnMobile?: boolean
  /**
   * Below `md`, render `actions` at the end of the mobile compact bar instead
   * of in the content row (the home timeline's Refresh). No effect from `md`
   * up, in section mode, or without the signed-in mobile navigation.
   */
  actionsInMobileBar?: boolean
}

const PageSubnavContext = createContext<ReactNode>(null)

/**
 * Hosts a section-level sub-navigation (admin tabs, etc.) that the closest
 * `PageHeader` will render inside its sticky chrome, directly below the title
 * row. Wrap the layout that owns the sub-nav so every child page automatically
 * gets the sub-nav pinned beneath the page header instead of scrolling above
 * it.
 */
export const PageSubnavProvider = ({
  subnav,
  children
}: {
  subnav: ReactNode
  children: ReactNode
}) => (
  <PageSubnavContext.Provider value={subnav}>
    {children}
  </PageSubnavContext.Provider>
)

const PageHeaderSectionContext = createContext<boolean>(false)

/**
 * Switches every descendant `PageHeader` into "section" mode: a plain,
 * non-sticky, non-breakout in-panel title block instead of the full-width
 * sticky chrome. Used by section layouts (settings, fitness) that render their
 * own dropdown sub-navigation above the content, so the per-page title sits at
 * the top of the content column. Default (no provider) keeps the original
 * sticky header untouched for timeline and admin.
 */
export const PageHeaderSectionProvider = ({
  children
}: {
  children: ReactNode
}) => (
  <PageHeaderSectionContext.Provider value={true}>
    {children}
  </PageHeaderSectionContext.Provider>
)

export const PageHeader = ({
  title,
  description,
  actions,
  className,
  stackActionsOnMobile,
  bottomSlot,
  back,
  compactTitle,
  flushOnMobile,
  actionsInMobileBar
}: PageHeaderProps) => {
  const subnav = useContext(PageSubnavContext)
  const isSection = useContext(PageHeaderSectionContext)
  const nav = useMobileNavigation()

  if (isSection) {
    return (
      <div className={cn('mb-6', className)}>
        <div
          className={cn(
            'flex gap-4',
            stackActionsOnMobile
              ? 'flex-col sm:flex-row sm:items-start sm:justify-between'
              : 'items-start justify-between'
          )}
        >
          <div className="min-w-0">
            {/* The section layout's PageHeader is the page's one h1; this is
                the child page's own title, so it is an h2 that looks the same. */}
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {description && (
              <div className="mt-1 text-sm text-muted-foreground">
                {description}
              </div>
            )}
          </div>
          {actions && (
            <div
              className={cn(
                'shrink-0',
                stackActionsOnMobile
                  ? 'self-start sm:self-center'
                  : 'self-center'
              )}
            >
              {actions}
            </div>
          )}
        </div>
        {subnav && <div className="mt-4">{subnav}</div>}
        {bottomSlot && <div className="mt-4">{bottomSlot}</div>}
      </div>
    )
  }

  // Below `md` a page under the mobile navigation gets the compact bar — menu
  // button and one title — and this header box becomes plain content under
  // it: the Back row, description, actions and sub-nav. From `md` up the box
  // keeps the sticky chrome it always had (every chrome class is `md:`
  // prefixed, so the desktop computed style is unchanged) and the bar is
  // `display: none`. Without a provider — logged-out pages (`PublicShell` has
  // no mobile navigation) and tests — the box renders exactly as before.
  const hasMobileBar = nav !== null
  // The bar title is the page's h1 below `md` unless the content keeps a more
  // specific heading of its own (`compactTitle`), so exactly one h1 is
  // displayed at any width.
  const hidesTitleOnMobile = hasMobileBar && !compactTitle
  // Actions the bar carries below `md`; the content row then hides its copy.
  const barActions = hasMobileBar && actionsInMobileBar ? actions : undefined
  const isEmptyOnMobile =
    hidesTitleOnMobile &&
    !back &&
    !description &&
    (!actions || Boolean(barActions)) &&
    !subnav

  const heading = (
    <h1
      className={cn(
        'text-xl font-semibold tracking-tight',
        // Beside the desktop arrow the title truncates on one line, as it did
        // inside the old heading; below `md` it is the content's own heading
        // under the Back row, and a long list or collection name wraps.
        back && 'min-w-0 truncate max-md:whitespace-normal max-md:break-words',
        hidesTitleOnMobile && 'max-md:hidden'
      )}
    >
      {title}
    </h1>
  )

  return (
    <>
      {hasMobileBar ? (
        <MobileCompactHeader
          title={compactTitle ?? title}
          as={compactTitle ? 'p' : 'h1'}
          bottomSlot={bottomSlot}
          actions={barActions}
          // The box below continues the bar, so the parent's vertical rhythm
          // (`space-y-*`) belongs after the box, not between the two — unless
          // the box has nothing to show on mobile and is hidden, and the page
          // has not asked for its content to meet the bar.
          className={isEmptyOnMobile && !flushOnMobile ? undefined : 'mb-0'}
        />
      ) : null}
      <div
        className={cn(
          hasMobileBar
            ? 'md:sticky md:top-0 md:z-20 md:border-b md:bg-surface-chrome md:backdrop-blur'
            : 'sticky top-0 z-20 border-b bg-surface-chrome backdrop-blur',
          isEmptyOnMobile && 'max-md:hidden',
          flushOnMobile && 'max-md:mb-0',
          className
        )}
        style={breakoutStyle}
      >
        <div
          className={cn(
            'mx-auto max-w-content px-4 py-4',
            back && hasMobileBar && 'max-md:pt-2'
          )}
        >
          <div
            className={cn(
              'flex gap-4',
              // From `md` up, an icon action (36px) already makes a row without
              // a description shorter than the described one (28px title + 2px
              // + 16px description = 46px). Pad it to that height so the box
              // matches the 79px of described pages and the content below does
              // not move. A title-only header keeps its own height.
              !description && actions && 'md:min-h-[46px]',
              stackActionsOnMobile
                ? 'flex-col sm:flex-row sm:items-start sm:justify-between'
                : 'items-start justify-between'
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                {back ? (
                  <div className="flex items-center gap-2 max-md:flex-col max-md:items-start max-md:gap-1">
                    <BackLink
                      href={back.href}
                      label={back.label}
                      accessibleName={back.accessibleName}
                      prefetch={back.prefetch}
                      iconOnlyFrom="md"
                    />
                    {heading}
                  </div>
                ) : (
                  heading
                )}
                {description && (
                  <div
                    className={cn(
                      'mt-0.5 text-xs text-muted-foreground',
                      // Below `md` the description is the content row's own
                      // text: 14px on a 20px line (a skeleton fills the same
                      // line), flush with the row's 16px top padding when the
                      // bar already carries the title.
                      hasMobileBar && 'max-md:min-h-5 max-md:text-sm',
                      hidesTitleOnMobile && 'max-md:mt-0'
                    )}
                  >
                    {description}
                  </div>
                )}
              </div>
            </div>
            {actions && (
              <div
                className={cn(
                  'shrink-0',
                  stackActionsOnMobile
                    ? 'self-start sm:self-center'
                    : 'self-center',
                  barActions && 'max-md:hidden'
                )}
              >
                {actions}
              </div>
            )}
          </div>
          {subnav && <div className="mt-3">{subnav}</div>}
        </div>
        {bottomSlot && (
          <div
            className={cn(
              'pointer-events-none absolute left-0 right-0 top-full pt-2',
              hasMobileBar && 'max-md:hidden'
            )}
          >
            <div className="mx-auto flex max-w-content justify-center px-4">
              {bottomSlot}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
