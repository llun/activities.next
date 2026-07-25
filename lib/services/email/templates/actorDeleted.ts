import { getConfig } from '@/lib/config'
import { headline, note, paragraph } from '@/lib/services/email/layout/blocks'
import { renderEmail } from '@/lib/services/email/layout/renderEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile, getMention } from '@/lib/types/domain/actor'

export interface ActorDeletedParams {
  /** The actor that was removed. */
  recipient: ActorProfile
  recipientEmail: string
  /** Instance contact address, if the admin has configured one. */
  contactEmail?: string
}

/**
 * Deletion receipt. The only email with no call to action: there is nothing
 * left to open, so the card closes on who to contact if this was unexpected.
 */
export const buildActorDeletedEmail = ({
  recipient,
  recipientEmail,
  contactEmail
}: ActorDeletedParams): RenderedEmail => {
  const { host } = getConfig()
  const handle = getMention(recipient, true)

  return renderEmail({
    subject: `Your actor ${handle} has been deleted from ${host}`,
    preheader: `Your actor ${handle} and all associated data have been permanently removed.`,
    blocks: [
      headline('Your actor was deleted'),
      paragraph([
        'Your actor ',
        { strong: handle },
        ' has been successfully deleted.'
      ]),
      paragraph(
        `All data associated with this actor, including posts, follows, and media, has been permanently removed from ${host}.`,
        { tight: true }
      ),
      note(
        contactEmail
          ? [
              'If you did not request this deletion, contact your server admin immediately at ',
              { label: contactEmail, href: `mailto:${contactEmail}` },
              '.'
            ]
          : 'If you did not request this deletion, contact your server admin immediately.'
      )
    ],
    footer: { kind: 'account', recipientEmail }
  })
}
