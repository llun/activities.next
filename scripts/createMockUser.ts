/**
 * Script to create a test user for development/testing
 * Usage: scripts/createMockUser [username] [email] [password]
 */
import * as bcrypt from 'bcrypt'
import crypto from 'crypto'

import { getConfig } from '../lib/config'
import { getDatabase } from '../lib/database'
import { generateKeyPair } from '../lib/utils/signature'

const BCRYPT_ROUND = 10
const SESSION_MAX_AGE_DAYS = 30

async function createMockUser() {
  const args = process.argv.slice(2)
  const username = args[0] || 'testuser'
  const email = args[1] || 'test@example.com'
  const password = args[2] || 'testpassword123'

  console.log('Creating test user...')
  console.log(`Username: ${username}`)
  console.log(`Email: ${email}`)
  console.log(`Password: ${password}`)

  const config = getConfig()
  const database = getDatabase()

  if (!database) {
    console.error('Error: Database is not available')
    process.exit(1)
  }

  const domain = config.host

  // Check if user already exists
  const [isAccountExists, isUsernameExists] = await Promise.all([
    database.isAccountExists({ email }),
    database.isUsernameExists({ username, domain })
  ])

  if (isAccountExists) {
    console.error(`Error: Account with email ${email} already exists`)
    process.exit(1)
  }

  if (isUsernameExists) {
    console.error(`Error: Username ${username} is already taken`)
    process.exit(1)
  }

  // Generate keys and hash password
  const [keyPair, passwordHash] = await Promise.all([
    generateKeyPair(config.secretPhase),
    bcrypt.hash(password, BCRYPT_ROUND)
  ])

  // Create the account (no email verification for test user)
  const accountId = await database.createAccount({
    domain,
    email,
    username,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    passwordHash
  })

  const now = Date.now()
  const sessionSpecs = [
    { label: 'Expired (2 days ago)', expiresAt: now - 2 * 24 * 60 * 60 * 1000 },
    { label: 'Expired (1 day ago)', expiresAt: now - 1 * 24 * 60 * 60 * 1000 },
    { label: 'Short-lived (2 hours)', expiresAt: now + 2 * 60 * 60 * 1000 },
    { label: 'Medium-term (1 day)', expiresAt: now + 1 * 24 * 60 * 60 * 1000 },
    { label: 'Week-long', expiresAt: now + 7 * 24 * 60 * 60 * 1000 },
    { label: 'Two weeks', expiresAt: now + 14 * 24 * 60 * 60 * 1000 },
    {
      label: 'Default max age (30 days)',
      expiresAt: now + SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    }
  ]

  const sessions = await Promise.all(
    sessionSpecs.map(async (spec) => {
      const token = crypto.randomBytes(32).toString('hex')
      await database.createAccountSession({
        accountId,
        token,
        expireAt: spec.expiresAt
      })

      return { token, expiresAt: spec.expiresAt, label: spec.label }
    })
  )

  console.log('\n✅ Test user created successfully!')
  console.log('\nLogin credentials:')
  console.log(`  Email: ${email}`)
  console.log(`  Password: ${password}`)
  console.log('\nMock sessions:')
  sessions.forEach((session) => {
    console.log(`  ${session.label}`)
    console.log(`    Token: ${session.token}`)
    console.log(`    Expires: ${new Date(session.expiresAt).toISOString()}`)
  })
  console.log('  Cookie name (dev): next-auth.session-token')
  console.log('  Cookie name (secure): __Secure-next-auth.session-token')
  console.log(`\nYou can now sign in at: http://localhost:3000/auth/signin`)

  process.exit(0)
}

createMockUser().catch((error) => {
  console.error('Error creating test user:', error)
  process.exit(1)
})
