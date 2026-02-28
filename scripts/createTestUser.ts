#!/usr/bin/env node

/**
 * Script to create a test user for development/testing
 * Usage: npx tsx scripts/createTestUser.ts [username] [email] [password]
 */
import * as bcrypt from 'bcrypt'

import { getConfig } from '../lib/config'
import { getDatabase } from '../lib/database'
import { generateKeyPair } from '../lib/utils/signature'

const BCRYPT_ROUND = 10

async function createTestUser() {
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
  await database.createAccount({
    domain,
    email,
    username,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    passwordHash
  })

  console.log('\n✅ Test user created successfully!')
  console.log('\nLogin credentials:')
  console.log(`  Email: ${email}`)
  console.log(`  Password: ${password}`)
  console.log(`\nYou can now sign in at: http://localhost:3000/auth/signin`)

  process.exit(0)
}

createTestUser().catch((error) => {
  console.error('Error creating test user:', error)
  process.exit(1)
})
