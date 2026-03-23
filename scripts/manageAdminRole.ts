#!/usr/bin/env -S node -r @swc-node/register
/**
 * Script to add or remove admin role for an account by email
 * Usage:
 *   scripts/manageAdminRole add <email>
 *   scripts/manageAdminRole remove <email>
 */
import { getKnex } from '@/lib/database'

async function manageAdminRole() {
  const args = process.argv.slice(2)
  const action = args[0]
  const email = args[1]

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
