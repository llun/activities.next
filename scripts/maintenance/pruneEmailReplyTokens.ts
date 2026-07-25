#!/usr/bin/env -S node scripts/run.cjs
/**
 * Delete expired reply-by-email tokens.
 *
 * Rows in `email_reply_tokens` stop working the moment they pass `expiresAt`
 * (see resolveReplyToken), so this is housekeeping rather than a security
 * control — nothing is left usable if it is never run. The rows are small and
 * `expiresAt` is indexed, which is why this is a script an operator can put on
 * a cron rather than a background job.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/pruneEmailReplyTokens [--dry-run]
 */
import { loadEnvConfig } from '@next/env'

import { getKnex } from '@/lib/database'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

async function pruneEmailReplyTokens() {
  const dryRun = process.argv.slice(2).includes('--dry-run')
  const knex = getKnex()
  const now = new Date()

  const [{ count } = { count: 0 }] = await knex('email_reply_tokens')
    .where('expiresAt', '<', now)
    .count({ count: '*' })

  const expired = Number(count)
  if (expired === 0) {
    console.log('No expired reply-by-email tokens to prune')
    process.exit(0)
  }

  if (dryRun) {
    console.log(`Would delete ${expired} expired reply-by-email token(s)`)
    process.exit(0)
  }

  const deleted = await knex('email_reply_tokens')
    .where('expiresAt', '<', now)
    .delete()
  console.log(`Deleted ${deleted} expired reply-by-email token(s)`)
  process.exit(0)
}

pruneEmailReplyTokens().catch((error) => {
  console.error('Error pruning reply-by-email tokens:', error)
  process.exit(1)
})
