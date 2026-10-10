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
  /**
   * For a page with no form: the "other" link, in an `AuthCardActions` band
   * under the content. A form page puts its own `AuthCardActions` inside its
   * `<form>` instead, so the submit button stays in the form.
   */
  footer?: ReactNode
  children?: ReactNode
}

/**
 * The card every standalone auth page sits in, and the box of its form: the
 * kit's `Frame` look (flat `rounded-lg border bg-background`, no shadow), with
 * the logo, a `text-xl` sentence-case h1 and a muted description centred in the
 * header, then the page's `AuthCardBody` (fields, labels above controls, no
 * inner `Frame`) and `AuthCardActions` (the one rule, then the submit button
 * and links). The `(nosidebar)` layout supplies the centring and the 28rem cap.
 * Failures go in an `Alert`.
 */
export const AuthCard: FC<Props> = ({
  title,
  description,
  logoSrc,
  footer,
  children
}) => (
  <Frame>
    <div className="space-y-2 p-6 pb-0 text-center">
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
    {footer ? (
      // With no body the band would butt against the header's description.
      <div className={children ? undefined : 'pt-6'}>
        <AuthCardActions>{footer}</AuthCardActions>
      </div>
    ) : null}
  </Frame>
)

/** The column of fields (or other content) under an auth card's header. */
export const AuthCardBody: FC<{ children: ReactNode }> = ({ children }) => (
  <div data-slot="auth-card-body" className="space-y-4 px-6 pt-6 pb-6">
    {children}
  </div>
)

/**
 * The action band at the bottom of an auth card, set off by the card's one top
 * border: the full-width submit button, any secondary action (the passkey
 * button) and the "Don't have an account? Sign up" style line.
 */
export const AuthCardActions: FC<{ children: ReactNode }> = ({ children }) => (
  <div
    data-slot="auth-card-actions"
    className="grid gap-3 border-t px-6 py-5 text-center text-sm text-muted-foreground"
  >
    {children}
  </div>
)

/** The centred line of links in an auth card's action band. */
export const AuthCardFooter: FC<{ children: ReactNode }> = ({ children }) => (
  <p>{children}</p>
)
