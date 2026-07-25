#!/usr/bin/env -S node scripts/run.cjs
/**
 * Renders the email templates to HTML files so they can be eyeballed in a
 * browser. Emails are not pages, so there is nothing to point a dev server at;
 * this is how a template change gets a real visual check before it ships.
 *
 * NOTE: covers only the templates listed in buildPreviews() below — currently
 * the four account/security emails and the six notification emails. The fitness
 * activity-import email is not on the shared layout yet; add it here in the PR
 * that migrates it.
 *
 * Pure function calls with fixture data — no database is opened, no network
 * request is made, and no mail is sent. Only `getConfig()`/`getBaseURL()` are
 * read, and the run.cjs bootstrap does not load `.env.local` on its own:
 *
 *   set -a; . ./.env.local; set +a
 *   node scripts/run.cjs scripts/mock/renderEmailPreviews.ts [outDir]
 *
 * `getConfig()` validates the whole environment schema, so a database entry has
 * to be present even though nothing connects to it. Without a `.env.local`,
 * pass throwaway values inline:
 *
 *   ACTIVITIES_HOST=llun.social ACTIVITIES_SECRET_PHASE=preview \
 *   ACTIVITIES_DATABASE_CLIENT=better-sqlite3 \
 *   ACTIVITIES_DATABASE_SQLITE_FILENAME=./unused.sqlite3 \
 *   node scripts/run.cjs scripts/mock/renderEmailPreviews.ts [outDir]
 *
 * Writes to a temporary directory by default so nothing lands in the working
 * tree, and prints a file:// URL for the index.
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { buildActorDeletedEmail } from '@/lib/services/email/templates/actorDeleted'
import { buildChangeEmail } from '@/lib/services/email/templates/changeEmail'
import { buildFollowEmail } from '@/lib/services/email/templates/follow'
import { buildFollowRequestEmail } from '@/lib/services/email/templates/followRequest'
import { buildLikeEmail } from '@/lib/services/email/templates/like'
import { buildMentionEmail } from '@/lib/services/email/templates/mention'
import { buildBoostEmail } from '@/lib/services/email/templates/reblog'
import { buildReplyEmail } from '@/lib/services/email/templates/reply'
import { buildResetPasswordEmail } from '@/lib/services/email/templates/resetPassword'
import { buildVerifyEmail } from '@/lib/services/email/templates/verifyEmail'
import { RenderedEmail } from '@/lib/services/email/types'
import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'

const RECIPIENT = 'anna@example.com'

// Production codes are crypto.randomBytes(32).toString('base64url') — 43
// characters, giving a ~98-character link. A short placeholder would fit the
// card comfortably and hide the wrapping problems a real link exposes, so the
// fixtures match the real length.
const FIXTURE_CODE = 'Yk3nQ8xR2vL7pT1wZ0aB5cD9eF4gH6jK8mN2qS5tU7x'

const fixtureActor = (
  username: string,
  domain: string,
  name?: string
): ActorProfile => ({
  id: `https://${domain}/users/${username}`,
  username,
  domain,
  name,
  followersUrl: `https://${domain}/users/${username}/followers`,
  inboxUrl: `https://${domain}/users/${username}/inbox`,
  sharedInboxUrl: `https://${domain}/inbox`,
  followingCount: 42,
  followersCount: 128,
  statusCount: 310,
  lastStatusAt: Date.now(),
  createdAt: Date.now()
})

const anna = fixtureActor('anna', 'llun.social', 'Anna')
const maythee = fixtureActor('maythee', 'mastodon.social', 'Maythee')
const ben = fixtureActor('ben', 'llun.social', 'Ben Carter')
const rin = fixtureActor('rin', 'pixelfed.social', 'Rin')

const fixtureStatus = (
  actor: ActorProfile,
  text: string,
  id: string
): EditableStatus =>
  ({
    id: `https://${actor.domain}/statuses/${id}`,
    url: `https://${actor.domain}/@${actor.username}/${id}`,
    actorId: actor.id,
    actor,
    isLocalActor: actor.domain === 'llun.social',
    type: StatusType.enum.Note,
    text,
    summary: '',
    to: [],
    cc: [],
    tags: [],
    attachments: [],
    replies: [],
    createdAt: 1_700_000_000_000
  }) as EditableStatus

const annaPost = fixtureStatus(
  anna,
  'Morning run done — 8.2 km along the river. The new shoes are holding up surprisingly well. #running',
  'note-88101'
)

interface Preview {
  slug: string
  group: string
  email: RenderedEmail
}

const buildPreviews = (): Preview[] => [
  {
    slug: 'verify-email',
    group: 'Account & security',
    email: buildVerifyEmail({
      recipientEmail: RECIPIENT,
      verificationCode: FIXTURE_CODE
    })
  },
  {
    slug: 'change-email',
    group: 'Account & security',
    email: buildChangeEmail({
      recipientEmail: 'new@example.com',
      emailChangeCode: FIXTURE_CODE
    })
  },
  {
    slug: 'reset-password',
    group: 'Account & security',
    email: buildResetPasswordEmail({
      recipientEmail: RECIPIENT,
      passwordResetCode: FIXTURE_CODE
    })
  },
  {
    slug: 'actor-deleted',
    group: 'Account & security',
    email: buildActorDeletedEmail({
      recipient: fixtureActor('runner', 'llun.social'),
      recipientEmail: RECIPIENT,
      contactEmail: 'admin@llun.social'
    })
  },
  {
    slug: 'follow',
    group: 'Notifications',
    email: buildFollowEmail({ recipient: anna, actor: maythee })
  },
  {
    slug: 'follow-request',
    group: 'Notifications',
    email: buildFollowRequestEmail({ recipient: anna, actor: ben })
  },
  {
    slug: 'mention',
    group: 'Notifications',
    email: buildMentionEmail({
      recipient: anna,
      actor: maythee,
      status: fixtureStatus(
        maythee,
        '@anna have you tried the new Garmin Connect sync yet? Curious how it handles multi-sport days.',
        'note-88213'
      )
    })
  },
  {
    slug: 'reply',
    group: 'Notifications',
    email: buildReplyEmail({
      recipient: anna,
      actor: rin,
      status: fixtureStatus(
        rin,
        'This is brilliant — federated fitness is genuinely the dream. Adding it to my instance tonight.',
        'note-88214'
      )
    })
  },
  {
    slug: 'like',
    group: 'Notifications',
    email: buildLikeEmail({ recipient: anna, actor: maythee, status: annaPost })
  },
  {
    slug: 'boost',
    group: 'Notifications',
    email: buildBoostEmail({ recipient: anna, actor: ben, status: annaPost })
  }
]

// Shows the HTML and its plain-text twin side by side, so text/HTML parity is
// checkable in the same glance as the visual review.
const renderIndex = (previews: Preview[]): string => {
  const groups = [...new Set(previews.map((preview) => preview.group))]
  const sections = groups
    .map((group) => {
      const rows = previews
        .filter((preview) => preview.group === group)
        .map(
          (preview) => `
  <section>
    <h3>${escapeHtml(preview.email.subject)} <small>${escapeHtml(preview.slug)}</small></h3>
    <div class="pair">
      <iframe src="./${encodeURIComponent(preview.slug)}.html" title="${escapeHtml(preview.slug)}"></iframe>
      <pre>${escapeHtml(preview.email.text)}</pre>
    </div>
  </section>`
        )
        .join('')
      return `<h2>${escapeHtml(group)}</h2>${rows}`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Email previews</title>
<style>
body{font:14px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:32px;background:#fafafa;color:#0a0a0a}
h1{font-size:24px}
h2{margin-top:40px;font-size:18px;border-bottom:1px solid #e5e5e5;padding-bottom:8px}
h3{font-size:15px;margin:24px 0 8px}
h3 small{font-weight:400;color:#737373;margin-left:8px}
.pair{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
iframe{width:620px;height:760px;border:1px solid #e5e5e5;border-radius:8px;background:#fff}
pre{flex:1;min-width:280px;margin:0;padding:16px;background:#fff;border:1px solid #e5e5e5;border-radius:8px;white-space:pre-wrap;font-size:12px;color:#404040}
</style>
</head>
<body>
<h1>Email previews</h1>
<p>HTML on the left, the plain-text alternative on the right.</p>
${sections}
</body>
</html>
`
}

async function renderEmailPreviews() {
  const outDir =
    process.argv[2] ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'emails-')))
  await fs.mkdir(outDir, { recursive: true })

  const previews = buildPreviews()
  await Promise.all(
    previews.map((preview) =>
      fs.writeFile(
        path.join(outDir, `${preview.slug}.html`),
        preview.email.html,
        'utf-8'
      )
    )
  )
  const indexPath = path.join(outDir, 'index.html')
  await fs.writeFile(indexPath, renderIndex(previews), 'utf-8')

  console.log(`Rendered ${previews.length} email previews`)
  console.log(`file://${indexPath}`)
}

renderEmailPreviews().catch((error) => {
  console.error(error)
  process.exit(1)
})
