import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildActorDeletedEmail } from './actorDeleted'
import { buildChangeEmail } from './changeEmail'
import { buildFollowEmail } from './follow'
import { buildFollowRequestEmail } from './followRequest'
import { buildLikeEmail } from './like'
import { buildMentionEmail } from './mention'
import { buildBoostEmail } from './reblog'
import { buildReplyEmail } from './reply'
import { buildResetPasswordEmail } from './resetPassword'
import { buildVerifyEmail } from './verifyEmail'

// Every string slot carries a hostile sentinel, so a template that forgets to
// escape one fails here rather than in someone's inbox.
const XSS = '"><script>alert(1)</script>'
// A real code is 43-char base64url; a short placeholder would not exercise the
// wrapping rules the layout applies to long links.
const CODE = 'Yk3nQ8xR2vL7pT1wZ0aB5cD9eF4gH6jK8mN2qS5tU7x'
const HOST = 'test.llun.dev'

const hostileActor: ActorProfile = {
  id: `javascript:alert(1)`,
  username: XSS,
  domain: XSS,
  name: XSS,
  followersUrl: '',
  inboxUrl: '',
  sharedInboxUrl: '',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1000
}

const hostileStatus = {
  id: XSS,
  // The nastiest input in the set: remote actors control this, and it is the
  // fallback getEmailStatusUrl returns when no local path can be derived.
  url: 'javascript:alert(1)',
  actorId: hostileActor.id,
  actor: hostileActor,
  isLocalActor: false,
  type: StatusType.enum.Note,
  text: `${XSS}<img src=x onerror=alert(1)>`,
  summary: '',
  to: [],
  cc: [],
  tags: [],
  attachments: [],
  replies: [],
  createdAt: 1000
} as unknown as EditableStatus

interface Case {
  description: string
  email: RenderedEmail
  /** actor-deleted is the only email with no call to action. */
  buttons: number
  footer: 'notification' | 'account'
}

const cases: Case[] = [
  {
    description: 'verify email',
    email: buildVerifyEmail({ recipientEmail: XSS, verificationCode: CODE }),
    buttons: 1,
    footer: 'account'
  },
  {
    description: 'change email',
    email: buildChangeEmail({ recipientEmail: XSS, emailChangeCode: CODE }),
    buttons: 1,
    footer: 'account'
  },
  {
    description: 'reset password',
    email: buildResetPasswordEmail({
      recipientEmail: XSS,
      passwordResetCode: CODE
    }),
    buttons: 1,
    footer: 'account'
  },
  {
    description: 'actor deleted',
    email: buildActorDeletedEmail({
      recipient: hostileActor,
      recipientEmail: XSS,
      contactEmail: XSS
    }),
    buttons: 0,
    footer: 'account'
  },
  {
    description: 'follow',
    email: buildFollowEmail({
      recipient: hostileActor,
      actor: hostileActor
    }),
    buttons: 1,
    footer: 'notification'
  },
  {
    description: 'follow request',
    email: buildFollowRequestEmail({
      recipient: hostileActor,
      actor: hostileActor
    }),
    buttons: 1,
    footer: 'notification'
  },
  {
    description: 'mention',
    email: buildMentionEmail({
      recipient: hostileActor,
      actor: hostileActor,
      status: hostileStatus
    }),
    // One, not zero: the hostile actor still yields a derivable local path, so
    // getEmailStatusUrl never reaches its status.url fallback. The refusal of a
    // javascript: url is covered separately below, with an actor-less status.
    buttons: 1,
    footer: 'notification'
  },
  {
    description: 'reply',
    email: buildReplyEmail({
      recipient: hostileActor,
      actor: hostileActor,
      status: hostileStatus
    }),
    buttons: 1,
    footer: 'notification'
  },
  {
    description: 'like',
    email: buildLikeEmail({
      recipient: hostileActor,
      actor: hostileActor,
      status: hostileStatus
    }),
    buttons: 1,
    footer: 'notification'
  },
  {
    description: 'boost',
    email: buildBoostEmail({
      recipient: hostileActor,
      actor: hostileActor,
      status: hostileStatus
    }),
    buttons: 1,
    footer: 'notification'
  }
]

/** A status with no actor, so getEmailStatusUrl falls back to its raw url. */
const actorlessHostileStatus = {
  ...hostileStatus,
  actor: undefined
} as unknown as EditableStatus

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

describe('email design conformance', () => {
  it.each(cases)('$description renders a well-formed document', ({ email }) => {
    expect(email.html.startsWith('<!doctype html>')).toBe(true)
    expect(email.html).toContain('<html lang="en">')
    expect(email.html.trimEnd().endsWith('</html>')).toBe(true)
    expect(email.html).toContain('<body')
  })

  it.each(cases)(
    '$description declares the email head metadata',
    ({ email }) => {
      expect(email.html).toContain('<meta charset="utf-8">')
      expect(email.html).toContain('name="color-scheme"')
      expect(email.html).toContain('name="format-detection"')
    }
  )

  it.each(cases)('$description uses one fluid 600px column', ({ email }) => {
    expect(email.html).toContain(
      'style="width:100%;max-width:600px;table-layout:fixed;"'
    )
    // The Outlook ghost table, which cannot use max-width.
    expect(email.html).toContain('<!--[if mso]><table role="presentation"')
  })

  it.each(cases)(
    '$description hides a preheader from the body',
    ({ email }) => {
      expect(email.html).toContain('mso-hide:all')
      expect(email.html).toContain('&zwnj;&nbsp;'.repeat(30))
    }
  )

  it.each(cases)(
    '$description titles the document with its subject',
    ({ email }) => {
      expect(email.html).toContain('<title>')
      expect(email.subject.length).toBeGreaterThan(0)
    }
  )

  it.each(cases)(
    '$description renders the expected number of call-to-action buttons',
    ({ email, buttons }) => {
      expect(count(email.html, 'bgcolor="#E66A0F"')).toBe(buttons)
    }
  )

  it.each(cases)(
    '$description uses the $footer footer',
    ({ email, footer }) => {
      if (footer === 'notification') {
        expect(email.html).toContain('Manage email notifications')
        expect(email.html).toContain(`https://${HOST}/settings/notifications`)
      } else {
        expect(email.html).toContain('This email was sent to')
        expect(email.html).not.toContain('Manage email notifications')
      }
    }
  )

  it.each(cases)('$description escapes every hostile input', ({ email }) => {
    // Assert on the sentinel itself, not on `"><`, which occurs legitimately at
    // every tag boundary.
    expect(email.html).not.toContain(XSS)
    expect(email.html).not.toContain('<script')
    expect(email.html).not.toContain('onerror=')
  })

  it.each(cases)('$description emits no dangerous url', ({ email }) => {
    expect(email.html).not.toContain('javascript:')
    expect(email.html).not.toContain('data:text/html')
  })

  it.each(cases)('$description emits no relative href or src', ({ email }) => {
    // A mail client has no origin to resolve one against.
    expect(email.html).not.toMatch(/(?:href|src)="\/(?!\/)/)
  })

  it.each(cases)('$description inlines all styling', ({ email }) => {
    expect(email.html).not.toContain('class="')
    // Exactly one <style>: the MSO font conditional.
    expect(count(email.html, '<style')).toBe(1)
  })

  it.each(cases)(
    '$description leaves no unresolved template value',
    ({ email }) => {
      for (const rendered of [email.html, email.text, email.subject]) {
        expect(rendered).not.toContain('${')
        expect(rendered).not.toContain('undefined')
        expect(rendered).not.toContain('NaN')
        expect(rendered).not.toContain('[object Object]')
      }
    }
  )

  it.each(cases)('$description ships a usable plain-text part', ({ email }) => {
    expect(email.text.length).toBeGreaterThan(0)
    // Assert no LAYOUT markup leaked into the text alternative. A bare `<` is
    // deliberately NOT the test: these fixtures put one in the display name,
    // and a literal angle bracket in a text/plain body is correct — it is a
    // character the user typed, not markup.
    expect(email.text).not.toMatch(
      /<\/?(?:table|tr|td|div|p|a|span|h1|img|body|html|strong)[\s/>]/i
    )
    expect(email.text).not.toContain('style="')
  })

  it.each([
    {
      description: 'mention',
      email: buildMentionEmail({
        recipient: hostileActor,
        actor: hostileActor,
        status: actorlessHostileStatus
      })
    },
    {
      description: 'reply',
      email: buildReplyEmail({
        recipient: hostileActor,
        actor: hostileActor,
        status: actorlessHostileStatus
      })
    },
    {
      description: 'like',
      email: buildLikeEmail({
        recipient: hostileActor,
        actor: hostileActor,
        status: actorlessHostileStatus
      })
    },
    {
      description: 'boost',
      email: buildBoostEmail({
        recipient: hostileActor,
        actor: hostileActor,
        status: actorlessHostileStatus
      })
    }
  ])(
    '$description drops the button rather than link a hostile status url',
    ({ email }) => {
      // With no actor there is no local path, so getEmailStatusUrl returns the
      // remote-controlled status.url. The button builder must refuse it.
      expect(email.html).not.toContain('javascript:')
      expect(count(email.html, 'bgcolor="#E66A0F"')).toBe(0)
    }
  )
})
