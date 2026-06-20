#!/usr/bin/env -S node scripts/run.cjs
/**
 * Script to add or remove admin role for an account by email
 * Usage:
 *   NODE_ENV=production scripts/manageAdminRole add <email>
 *   NODE_ENV=production scripts/manageAdminRole remove <email>
 */
import { loadEnvConfig } from '@next/env'

import { getKnex } from '@/lib/database'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

async function manageAdminRole() {
  const args = process.argv.slice(2)
  const action = args[0]
  // Stored emails are normalized (trimmed + lowercased); normalize the lookup
  // key too so a mixed-case argument still matches the canonical row.
  const email = args[1] ? normalizeEmail(args[1]) : args[1]

  if (!action || !email || !['add', 'remove'].includes(action)) {
    console.log('Usage:')
    console.log('  scripts/manageAdminRole add <email>')
    console.log('  scripts/manageAdminRole remove <email>')
    process.exit(1)
  }

  const knex = getKnex()

  const account = await knex('accounts').where('email', email).first()
  if (!account) {
    console.error(`Error: No account found with email "${email}"`)
    process.exit(1)
  }

  const newRole = action === 'add' ? 'admin' : null

  if (action === 'add' && account.role === 'admin') {
    console.log(`Account "${email}" already has admin role`)
    process.exit(0)
  }

  if (action === 'remove' && account.role !== 'admin') {
    console.log(`Account "${email}" does not have admin role`)
    process.exit(0)
  }

  await knex('accounts').where('email', email).update({ role: newRole })

  if (action === 'add') {
    console.log(`Admin role added to account "${email}"`)
  } else {
    console.log(`Admin role removed from account "${email}"`)
  }

  process.exit(0)
}

manageAdminRole().catch((error) => {
  console.error('Error managing admin role:', error)
  process.exit(1)
})
