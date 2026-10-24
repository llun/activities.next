import {
  type EmailBrand,
  brandBaseURL,
  brandHost
} from '@/lib/services/email/brand'
import {
  button,
  fallbackUrl,
  headline,
  note,
  paragraph
} from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'

export interface AccountArchiveReadyParams {
  recipientEmail: string
  archiveId: string
  /** The size of the zip, in bytes. */
  bytes: number
  /** When the file is deleted (epoch milliseconds). */
  expiresAt: number
  /** The visited or recipient domain's name and host; the primary's when omitted. */
  brand?: EmailBrand
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** The account export finished and is waiting for its owner to download it. */
export const buildAccountArchiveReadyEmail = ({
  recipientEmail,
  archiveId,
  bytes,
  expiresAt,
  brand
}: AccountArchiveReadyParams): RenderedEmail => {
  const host = brandHost(brand)
  const url = `${brandBaseURL(brand)}/api/v1/account/archives/${encodeURIComponent(archiveId)}/download`
  const expires = new Date(expiresAt).toLocaleDateString('en-GB', {
    dateStyle: 'long',
    timeZone: 'UTC'
  })

  return renderEmail({
    brand,
    subject: `Your ${host} account archive is ready`,
    preheader: `Download your archive (${formatBytes(bytes)}) before ${expires}.`,
    blocks: [
      headline('Your account archive is ready'),
      paragraph(
        `The archive you requested from ${host} is ready to download (${formatBytes(bytes)}). Sign in to your account if you are asked to.`
      ),
      button({ label: 'Download archive', url }),
      fallbackUrl(url),
      note(
        `The file is deleted on ${expires} (UTC). You can request a new archive once every 7 days.`
      )
    ],
    footer: { kind: 'account', recipientEmail }
  })
}
