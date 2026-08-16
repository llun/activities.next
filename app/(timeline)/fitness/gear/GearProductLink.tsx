'use client'

import { ExternalLink } from 'lucide-react'
import { FC, MouseEventHandler } from 'react'

import { getProductUrlHostname } from '@/app/(timeline)/fitness/gear/gearUi'

interface Props {
  /** The stored value, which may be anything a pre-validation row carried. */
  productUrl: string | null
  /**
   * Opens the gear form so a missing link can be filled in. A surface with no
   * form to open — the gear list — omits it and gets the em dash instead.
   */
  onEdit?: () => void
  /**
   * Needed inside a row that navigates on click: without stopping the event
   * the anchor opens the vendor's page AND the row pushes the gear's route
   * behind it.
   */
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

/**
 * The manufacturer's page a gear links out to. Shared by every surface that
 * shows one — a bike's page, a pair of shoes', a device's, and the gear list's
 * device table — because a reader who learns what the link looks like on one
 * should not have to learn it again on another.
 *
 * The anchor is gated on `getProductUrlHostname`, not on the string being
 * non-empty: it returns null for anything that is not an http(s) URL, so a row
 * predating the API's validation cannot turn into a `javascript:` href here.
 * Where there is a form to open, the empty state becomes the prompt that opens
 * it rather than disappearing — a field nobody can find is a field nobody
 * fills in.
 *
 * The hostname is what is shown ("moots.com", not the full URL), which leaves
 * the link with no accessible name beyond a domain — hence the `aria-label`,
 * which keeps the visible text inside it. The orange is `text-primary-text`,
 * the accessible foreground twin of `--primary`: `text-primary` itself is
 * 3.37:1 on the card and fails AA for text.
 */
export const GearProductLink: FC<Props> = ({ productUrl, onEdit, onClick }) => {
  const hostname = getProductUrlHostname(productUrl)

  if (!productUrl || !hostname) {
    if (!onEdit) return <>—</>
    return (
      <button
        type="button"
        className="cursor-pointer hover:text-foreground hover:underline"
        onClick={onEdit}
      >
        No product page — add one
      </button>
    )
  }

  return (
    <a
      href={productUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Product page: ${hostname}`}
      className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline"
      onClick={onClick}
    >
      <ExternalLink className="size-3 shrink-0" />
      {hostname}
    </a>
  )
}
