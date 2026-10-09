import Image from 'next/image'
import { FC, ReactNode } from 'react'

import { Frame } from '@/lib/components/surface/Frame'

interface Props {
  /** The page's one h1: sentence case, saying what this screen is for. */
  title: ReactNode
  /** Muted line under the title. */
  description?: ReactNode
  /**
   * The brand mark above the title. Absolute URL on the configured host (see
   * `getAuthLogoSrc`), so it resolves against the canonical origin.
   */
  logoSrc?: string
  /** A bar under the content, set off by a top border: the "other" link. */
  footer?: ReactNode
  children?: ReactNode
}

/**
 * The card every standalone auth page sits in: the kit's `Frame` look (flat
 * `rounded-lg border bg-background`, no shadow), with the logo, a `text-xl`
 * sentence-case h1 and a muted description centred over a single column of
 * content. The `(nosidebar)` layout supplies the centring and the 28rem cap.
 * Fields go in a `Frame divided` of stacked `FormRow`s, failures in an `Alert`.
 */
export const AuthCard: FC<Props> = ({
  title,
  description,
  logoSrc,
  footer,
  children
}) => (
  <Frame footer={footer}>
    <div className="space-y-6 p-6">
      <div className="space-y-2 text-center">
        {logoSrc ? (
          <Image
            src={logoSrc}
            alt=""
            aria-hidden="true"
            width={48}
            height={48}
            className="mx-auto mb-3 h-12 w-12 object-contain"
          />
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  </Frame>
)

/** The centred line of links in an auth card's footer. */
export const AuthCardFooter: FC<{ children: ReactNode }> = ({ children }) => (
  <p className="text-center text-sm text-muted-foreground">{children}</p>
)
