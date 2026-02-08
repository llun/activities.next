/**
 * SQL to Firestore Migration Script
 * 
 * Usage:
 * 1. Ensure your current database config (config.json or ACTIVITIES_DATABASE) is SQL.
 * 2. Set the following environment variables for Firestore:
 *    - ACTIVITIES_DATABASE_FIRESTORE_PROJECT_ID
 *    - ACTIVITIES_DATABASE_FIRESTORE_HOST (optional, for emulator)
 *    - ACTIVITIES_DATABASE_FIRESTORE_PORT (optional, for emulator)
 * 3. Run: yarn migrate:firestore
 */
import { Firestore } from '@google-cloud/firestore'
import knex from 'knex'
import { getConfig } from '../lib/config'
import { getFirestore } from '../lib/database/firestore/utils'

async function migrate() {
  const config = getConfig()
  if (config.database.client === 'firestore') {
    console.error('Error: Current database is already set to firestore. Please provide SQL config in ACTIVITIES_DATABASE or config.json')
    process.exit(1)
  }

  const sqlDb = knex(config.database)
  
  // You need to set these env vars for Firestore destination
  const firestoreProjectId = process.env.ACTIVITIES_DATABASE_FIRESTORE_PROJECT_ID
  if (!firestoreProjectId) {
    console.error('Error: ACTIVITIES_DATABASE_FIRESTORE_PROJECT_ID is required')
    process.exit(1)
  }

  const firestoreDb = getFirestore({
    client: 'firestore',
    projectId: firestoreProjectId,
    host: process.env.ACTIVITIES_DATABASE_FIRESTORE_HOST,
    port: process.env.ACTIVITIES_DATABASE_FIRESTORE_PORT ? parseInt(process.env.ACTIVITIES_DATABASE_FIRESTORE_PORT, 10) : undefined,
    ssl: process.env.ACTIVITIES_DATABASE_FIRESTORE_SSL === 'true'
  })

  const tables = [
    { from: 'accounts', to: 'accounts', idField: 'id' },
    { 
      from: 'actors', 
      to: 'actors', 
      idField: 'id',
      transform: (row: any) => {
        const settings = JSON.parse(row.settings)
        return {
          ...row,
          followersUrl: settings.followersUrl,
          inboxUrl: settings.inboxUrl,
          sharedInboxUrl: settings.sharedInboxUrl
        }
      }
    },
    { from: 'statuses', to: 'statuses', idField: 'id' },
    { from: 'status_history', to: 'status_history', idField: 'id' },
    { from: 'recipients', to: 'recipients', idField: 'id' },
    { from: 'tags', to: 'tags', idField: 'id' },
    { 
      from: 'poll_choices', 
      to: 'poll_choices', 
      customId: (row: any) => `${row.statusId}:${row.choiceId}`
    },
    { 
      from: 'poll_answers', 
      to: 'poll_answers', 
      customId: (row: any) => `${row.statusId}:${row.actorId}:${row.choice}`
    },
    { from: 'follows', to: 'follows', idField: 'id' },
    { 
      from: 'likes', 
      to: 'likes', 
      customId: (row: any) => `${row.actorId}:${row.statusId}`
    },
    { from: 'sessions', to: 'sessions', idField: 'token' },
    { from: 'account_providers', to: 'account_providers', idField: 'id' },
    { 
      from: 'timelines', 
      to: 'timelines', 
      customId: (row: any) => `${row.timeline}:${row.actorId}:${row.statusId}`
    },
    { 
      from: 'counters', 
      to: 'counters', 
      customId: (row: any) => row.id,
      transform: (row: any) => ({
        count: row.value,
        updatedAt: row.updatedAt
      })
    },
    { from: 'notifications', to: 'notifications', idField: 'id' },
    { from: 'clients', to: 'oauth_clients', idField: 'id' },
    { from: 'tokens', to: 'oauth_tokens', idField: 'accessToken' },
    { from: 'auth_codes', to: 'oauth_auth_codes', idField: 'code' },
    { from: 'fitness_settings', to: 'fitness_settings', idField: 'actorId' }
  ]

  for (const table of tables) {
    console.log(`Migrating ${table.from} to ${table.to}...`)
    try {
      const rows = await sqlDb(table.from).select('*')
      console.log(`Found ${rows.length} rows in ${table.from}`)

      let count = 0
      let batch = firestoreDb.batch()

      for (const row of rows) {
        const transformedRow = table.transform ? table.transform(row) : row
        
        let docRef
        if (table.idField) {
          docRef = firestoreDb.collection(table.to).doc(encodeURIComponent(transformedRow[table.idField]))
        } else if (table.customId) {
          docRef = firestoreDb.collection(table.to).doc(encodeURIComponent(table.customId(transformedRow)))
        } else {
          docRef = firestoreDb.collection(table.to).doc()
        }

        batch.set(docRef, transformedRow)
        count++

        if (count % 500 === 0) {
          await batch.commit()
          batch = firestoreDb.batch()
          console.log(`  - Migrated ${count} rows...`)
        }
      }

      if (count % 500 !== 0) {
        await batch.commit()
      }
      console.log(`Finished migrating ${table.from}. Total: ${count} rows.`)
    } catch (error: any) {
      if (error.code === 'ER_NO_SUCH_TABLE' || error.message.includes('does not exist')) {
        console.warn(`Table ${table.from} does not exist, skipping...`)
      } else {
        console.error(`Error migrating ${table.from}:`, error)
      }
    }
  }

  await sqlDb.destroy()
  console.log('Migration complete!')
}

migrate().catch(console.error)
