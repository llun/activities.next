/**
 * `exportActorArchive` keeps the files a photo edit holds beside the live one
 * (the uploaded original and earlier renders a post may still show), so a
 * restored account can still revert its photos. Same harness as
 * `actorArchiveExport.test.ts`: the storage copy is mocked and the plan it is
 * handed is what is checked.
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const DOMAIN = 'actor-archive-edits-test.llun.test'
const USERNAME = 'editowner'

const holder = vi.hoisted(() => ({
  database: null as unknown as Database,
  mediaFilePaths: null as string[] | null
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => holder.database
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: DOMAIN,
    trustedHosts: [],
    mediaStorage: undefined
  })
}))

vi.mock('@/lib/services/fitness-files', () => ({
  getEffectiveFitnessStorageConfig: () => null
}))

vi.mock('@/lib/services/medias/uploadSizeLimit', () => ({
  getMaxMediaUploadSize: async () => 1024 * 1024
}))

vi.mock('../fitness/describeConnection', () => ({
  printDatabaseBanner: () => undefined
}))

vi.mock('./productionArchive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./productionArchive')>()
  return {
    ...actual,
    loadEnvFile: async () => undefined,
    buildStoragePlan: (
      input: Parameters<typeof actual.buildStoragePlan>[0]
    ) => {
      holder.mediaFilePaths = input.mediaFilePaths
      return []
    },
    archiveStorage: async () => [],
    createTarArchive: async () => undefined
  }
})

const { exportActorArchive } = await import('./actorArchive')

describe('exportActorArchive photo edits', () => {
  it('archives the edit files of the actor media next to the live file', async () => {
    const database = getTestSQLDatabase()
    holder.database = database
    holder.mediaFilePaths = null
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const outputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-edits-test-')
    )

    try {
      await database.migrate()
      await database.createAccount({
        domain: DOMAIN,
        email: `${USERNAME}@example.test`,
        username: USERNAME,
        privateKey: 'test-private-key',
        publicKey: 'test-public-key',
        passwordHash: 'unused'
      })
      const actor = (await database.getActorFromUsername({
        username: USERNAME,
        domain: DOMAIN
      }))!
      const media = (await database.createMedia({
        actorId: actor.id,
        original: {
          path: 'medias/uploaded.jpg',
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 40, height: 30 }
        }
      }))!
      const statusId = `${actor.id}/statuses/edited-photo`
      await database.createNote({
        id: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        url: statusId,
        text: 'An edited photo'
      })
      await database.createAttachment({
        actorId: actor.id,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://${DOMAIN}/api/v1/files/medias/uploaded.jpg`,
        mediaId: media.id
      })
      for (const [index, name] of ['first', 'second'].entries()) {
        await database.applyMediaEdit({
          mediaId: media.id,
          accountId: actor.account!.id,
          baseVersion: index,
          saveId: name,
          recipe: '{"v":1}',
          render: {
            path: `medias/${name}.webp`,
            bytes: 100,
            mimeType: 'image/webp',
            width: 40,
            height: 30,
            blurhash: null,
            focus: null
          }
        })
      }

      const exitCode = await exportActorArchive([
        '--username',
        USERNAME,
        '--domain',
        DOMAIN,
        '--output-dir',
        outputDir
      ])

      expect(exitCode).toBe(0)
      expect([...(holder.mediaFilePaths ?? [])].sort()).toEqual([
        'medias/first.webp',
        'medias/second.webp',
        'medias/uploaded.jpg'
      ])
    } finally {
      await database.destroy()
      logSpy.mockRestore()
      await fs.rm(outputDir, { force: true, recursive: true })
    }
  })
})
