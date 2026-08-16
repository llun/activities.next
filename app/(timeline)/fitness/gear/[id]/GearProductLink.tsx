'use client'

import { ExternalLink } from 'lucide-react'
import { FC } from 'react'

import { getProductUrlHostname } from '@/app/(timeline)/fitness/gear/gearUi'

interface Props {
  /** The stored value, which may be anything a pre-validation row carried. */
  productUrl: string | null
  /** Opens the gear form so the missing link can be filled in. */
  onEdit: () => void
}

/**
 * The line under a gear's meta that links out to the manufacturer's page.
 * Shared by every kind's page — a bike, a pair of shoes and a recording device
 * all carry one, and a reader who learns what the link looks like on one page
 * should not have to learn it again on another.
 *
 * The anchor is gated on `getProductUrlHostname`, not on the string being
 * non-empty: it returns null for anything that is not an http(s) URL, so a row
 * predating the API's validation cannot turn into a `javascript:` href here.
 * When there is nothing to link to the line becomes the prompt that opens the
 * form, rather than disappearing — an empty field nobody can find is a field
 * nobody fills in.
 *
 * The hostname is what is shown ("moots.com", not the full URL) and it carries
 * the orange `text-primary-text`, the accessible foreground twin of `--primary`
 * — `text-primary` itself is 3.37:1 on the card and fails AA for text.
 */
export const GearProductLink: FC<Props> = ({ productUrl, onEdit }) => {
  const hostname = getProductUrlHostname(productUrl)

  if (!productUrl || !hostname) {
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
      className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline"
    >
      <ExternalLink className="size-3 shrink-0" />
      {hostname}
    </a>
  )
}
