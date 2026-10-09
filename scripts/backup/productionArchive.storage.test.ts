import { S3Client } from '@aws-sdk/client-s3'
import fs from 'fs/promises'
import knex from 'knex'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { MediaStorageType } from '@/lib/config/mediaStorage'

import type { StorageSource } from './productionArchive'
import {
  archiveStorage,
  buildStoragePlan,
  createS3Client,
  fetchPublicStorageResponse,
  getReferencedStoragePaths,
  getStorageEndpoint,
  normalizeStorageHostname,
  redactStorageError
} from './productionArchive'

describe('production archive scripts', () => {
  describe('buildStoragePlan', () => {
    it('downloads referenced media and fitness files without duplicating a shared fitness prefix', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp', 'fitness/legacy.fit'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          region: 'auto',
          prefix: 'fitness/'
        }
      })

      expect(plan).toEqual([
        {
          destination: 'media',
          files: ['medias/image.webp'],
          source: {
            bucket: 'activitynext',
            kind: 's3',
            prefix: undefined,
            region: 'auto'
          }
        },
        {
          destination: 'fitness',
          files: ['2026-01-01/activity.fit'],
          source: {
            bucket: 'activitynext',
            kind: 's3',
            prefix: 'fitness/',
            region: 'auto'
          }
        }
      ])
    })

    it('preserves public hostnames and endpoints for S3-compatible clients', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'media-storage.example.com',
          endpoint: 'https://media-api.example.com',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'fitness-storage.example.com',
          endpoint: 'https://fitness-api.example.com',
          prefix: 'fitness/',
          region: 'auto'
        }
      })

      expect(plan[0].source).toMatchObject({
        hostname: 'media-storage.example.com',
        endpoint: 'https://media-api.example.com'
      })
      expect(plan[1].source).toMatchObject({
        hostname: 'fitness-storage.example.com',
        endpoint: 'https://fitness-api.example.com'
      })
    })

    it('does not deduplicate S3 fitness files from a different endpoint', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp', 'fitness/legacy.fit'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'media-storage.example.com',
          endpoint: 'https://media-api.example.com',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'fitness-storage.example.com',
          endpoint: 'https://fitness-api.example.com',
          prefix: 'fitness/',
          region: 'auto'
        }
      })

      expect(plan[0]).toMatchObject({
        destination: 'media',
        files: ['fitness/legacy.fit', 'medias/image.webp']
      })
    })

    it('does not deduplicate S3 fitness files from a different legacy hostname endpoint', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp', 'fitness/legacy.fit'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'media-storage.example.com',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'fitness-storage.example.com',
          prefix: 'fitness/',
          region: 'auto'
        }
      })

      expect(plan[0]).toMatchObject({
        destination: 'media',
        files: ['fitness/legacy.fit', 'medias/image.webp']
      })
    })

    it('does not deduplicate S3 fitness files from a different endpoint scheme', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp', 'fitness/legacy.fit'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          endpoint: 'http://storage.example.com',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          endpoint: 'https://storage.example.com',
          prefix: 'fitness/',
          region: 'auto'
        }
      })

      expect(plan[0]).toMatchObject({
        destination: 'media',
        files: ['fitness/legacy.fit', 'medias/image.webp']
      })
    })

    it('deduplicates S3 fitness files when endpoints normalize to the same endpoint', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp', 'fitness/legacy.fit'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          endpoint: 'https://storage.example.com/',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          endpoint: 'storage.example.com',
          prefix: 'fitness/',
          region: 'auto'
        }
      })

      expect(plan[0]).toMatchObject({
        destination: 'media',
        files: ['medias/image.webp']
      })
    })

    it('filters referenced media files inside a shared local fitness directory', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: [
          'images/photo.webp',
          'fitness/legacy.fit',
          'fitness/maps/map.webp'
        ],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.LocalFile,
          path: '/tmp/activitynext/uploads'
        },
        fitnessStorage: {
          type: FitnessStorageType.LocalFile,
          path: '/tmp/activitynext/uploads/fitness'
        }
      })

      expect(plan).toEqual([
        {
          destination: 'media',
          files: ['images/photo.webp'],
          source: {
            kind: 'local',
            path: '/tmp/activitynext/uploads'
          }
        },
        {
          destination: 'fitness',
          files: ['2026-01-01/activity.fit'],
          source: {
            kind: 'local',
            path: '/tmp/activitynext/uploads/fitness'
          }
        }
      ])
    })

    it('sets shared local fitness exclusions once for all-storage mode', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: [],
        mediaFilePaths: [],
        scope: 'all',
        mediaStorage: {
          type: MediaStorageType.LocalFile,
          path: '/tmp/activitynext/uploads'
        },
        fitnessStorage: {
          type: FitnessStorageType.LocalFile,
          path: '/tmp/activitynext/uploads/fitness'
        }
      })

      expect(plan[0]).toMatchObject({
        destination: 'media',
        excludePrefixes: ['fitness']
      })
    })
  })

  describe('getReferencedStoragePaths', () => {
    it('collects media and fitness paths with keyset pagination', async () => {
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })
      const mediaCount = 1005
      const fitnessCount = 1005

      try {
        await database.schema.createTable('medias', (table) => {
          table.increments('id').primary()
          table.string('original')
          table.string('thumbnail')
        })
        await database.schema.createTable('fitness_files', (table) => {
          table.string('id').primary()
          table.string('path')
          table.string('mapImagePath')
          table.string('mapImageEmailPath')
        })

        await database.batchInsert(
          'medias',
          Array.from({ length: mediaCount }, (_, index) => ({
            original: `medias/original-${index}.webp`,
            thumbnail: index % 2 === 0 ? `medias/thumb-${index}.webp` : null
          })),
          200
        )
        await database.batchInsert(
          'fitness_files',
          Array.from({ length: fitnessCount }, (_, index) => ({
            id: `fitness-${String(index).padStart(4, '0')}`,
            mapImagePath: index % 2 === 0 ? `medias/map-${index}.webp` : null,
            mapImageEmailPath:
              index % 2 === 0 ? `medias/map-${index}.jpg` : null,
            path: `fitness/${index}.fit`
          })),
          200
        )

        const paths = await getReferencedStoragePaths(database)

        expect(paths.fitnessFilePaths).toHaveLength(fitnessCount)
        expect(paths.mediaFilePaths).toHaveLength(
          mediaCount +
            Math.ceil(mediaCount / 2) +
            Math.ceil(fitnessCount / 2) * 2
        )
        expect(paths.fitnessFilePaths).toContain('fitness/1004.fit')
        expect(paths.mediaFilePaths).toContain('medias/original-1004.webp')
        expect(paths.mediaFilePaths).toContain('medias/map-1004.webp')
        expect(paths.mediaFilePaths).toContain('medias/map-1004.jpg')
      } finally {
        await database.destroy()
      }
    })
  })

  describe('createS3Client', () => {
    it('uses the configured endpoint as the S3-compatible endpoint', async () => {
      expect(normalizeStorageHostname('https://storage.example.com/')).toBe(
        'storage.example.com'
      )
      expect(getStorageEndpoint('http://localhost:9000/')).toBe(
        'http://localhost:9000'
      )

      const client = createS3Client({
        bucket: 'bucket',
        endpoint: 'http://storage.example.com/',
        hostname: 'public-storage.example.com',
        kind: 's3',
        region: 'auto'
      })

      try {
        const endpoint = await client.config.endpoint!()
        expect(endpoint.hostname).toBe('storage.example.com')
        expect(endpoint.protocol).toBe('http:')
      } finally {
        client.destroy()
      }
    })

    it('falls back to hostname as the S3-compatible endpoint for legacy archive configs', async () => {
      const [entry] = buildStoragePlan({
        fitnessFilePaths: [],
        mediaFilePaths: ['medias/image.webp'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'bucket',
          hostname: 'legacy-storage.example.com',
          region: 'auto'
        }
      })

      expect(entry.source).toMatchObject({
        endpointFallback: 'legacy-storage.example.com',
        hostname: 'legacy-storage.example.com',
        kind: 's3'
      })

      if (entry.source.kind !== 's3') {
        throw new Error('Expected S3 storage source')
      }

      const client = createS3Client(entry.source)

      try {
        const endpoint = await client.config.endpoint!()
        expect(endpoint.hostname).toBe('legacy-storage.example.com')
        expect(endpoint.protocol).toBe('https:')
      } finally {
        client.destroy()
      }
    })

    it('does not treat public S3 hostnames as S3-compatible endpoints', () => {
      const client = createS3Client({
        bucket: 'bucket',
        hostname: 'public-cdn.example.com',
        kind: 's3',
        region: 'eu-central-1'
      })

      try {
        expect(client.config.endpoint).toBeUndefined()
      } finally {
        client.destroy()
      }
    })
  })

  describe('fetchPublicStorageResponse', () => {
    const originalFetch = global.fetch

    afterEach(() => {
      global.fetch = originalFetch
      vi.useRealTimers()
    })

    it('clears the response timeout after the public storage request starts', async () => {
      vi.useFakeTimers()
      global.fetch = vi.fn(async () => {
        return new Response('ok')
      }) as typeof fetch

      const response = await fetchPublicStorageResponse(
        'https://storage.example.com/file.txt'
      )

      expect(response.ok).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://storage.example.com/file.txt',
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      )
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('archiveStorage', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'production-archive-storage-test-')
      )
    })

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('removes partial files for allowed missing storage downloads', async () => {
      const sendSpy = vi
        .spyOn(S3Client.prototype, 'send')
        .mockImplementation((async (command: { input?: { Key?: string } }) => {
          if (command.input?.Key === 'bad.txt') {
            return {
              Body: Readable.from(
                (async function* streamPartialThenFail() {
                  yield Buffer.from('partial')
                  throw new Error('stream failed')
                })()
              )
            }
          }

          return { Body: Readable.from([Buffer.from('ok')]) }
        }) as typeof S3Client.prototype.send)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await fs.mkdir(path.join(tempDir, 'storage', 'media', 'files'), {
          recursive: true
        })
        await fs.writeFile(
          path.join(tempDir, 'storage', 'media', 'files', 'bad.txt'),
          'stale partial'
        )

        const manifest = await archiveStorage(
          [
            {
              destination: 'media',
              files: ['bad.txt', 'good.txt'],
              source: {
                bucket: 'activitynext',
                kind: 's3',
                region: 'auto'
              }
            }
          ],
          tempDir,
          { allowMissingStorage: true }
        )

        expect(manifest).toEqual([
          expect.objectContaining({
            destination: 'media',
            // A mid-stream failure classifies itself only in its message,
            // which `redactStorageError` withholds from the manifest.
            failedFiles: [{ error: 'unknown', path: 'bad.txt' }],
            fileCount: 1,
            totalBytes: 2
          })
        ])
        await expect(
          fs.readFile(
            path.join(tempDir, 'storage', 'media', 'files', 'good.txt'),
            'utf-8'
          )
        ).resolves.toBe('ok')
        await expect(
          fs.access(path.join(tempDir, 'storage', 'media', 'files', 'bad.txt'))
        ).rejects.toThrow()
      } finally {
        sendSpy.mockRestore()
        logSpy.mockRestore()
        errorSpy.mockRestore()
      }
    })

    it.each([
      {
        description: 'an internal hostname',
        error: Object.assign(
          new Error('getaddrinfo ENOTFOUND minio.internal'),
          {
            code: 'ENOTFOUND',
            hostname: 'minio.internal',
            syscall: 'getaddrinfo'
          }
        ),
        expected: 'getaddrinfo ENOTFOUND',
        secret: 'minio.internal'
      },
      {
        description: 'the bucket name',
        error: Object.assign(
          new Error(
            'The specified bucket does not exist: activitynext-prod-media'
          ),
          {
            $metadata: { httpStatusCode: 404 },
            name: 'NoSuchBucket'
          }
        ),
        expected: 'NoSuchBucket HTTP 404',
        secret: 'activitynext-prod-media'
      },
      {
        description: 'a bare IP address',
        error: Object.assign(new Error('connect ECONNREFUSED 10.4.2.11:9000'), {
          address: '10.4.2.11',
          code: 'ECONNREFUSED',
          port: 9000,
          syscall: 'connect'
        }),
        expected: 'connect ECONNREFUSED',
        secret: '10.4.2.11'
      }
    ])(
      'keeps $description out of a failed file entry',
      async ({ error, expected, secret }) => {
        const sendSpy = vi
          .spyOn(S3Client.prototype, 'send')
          .mockImplementation((async () => {
            throw error
          }) as typeof S3Client.prototype.send)
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        try {
          const manifest = await archiveStorage(
            [
              {
                destination: 'media',
                files: ['ab/cd.webp'],
                source: {
                  bucket: 'activitynext-prod-media',
                  kind: 's3',
                  region: 'auto'
                }
              }
            ],
            tempDir,
            { allowMissingStorage: true }
          )

          expect(manifest).toEqual([
            expect.objectContaining({
              failedFiles: [{ error: expected, path: 'ab/cd.webp' }]
            })
          ])
          expect(JSON.stringify(manifest)).not.toContain(secret)
        } finally {
          sendSpy.mockRestore()
          logSpy.mockRestore()
          errorSpy.mockRestore()
        }
      }
    )

    it('keeps the local storage root out of a failed file entry', async () => {
      const missingRoot = path.join(tempDir, 'missing-storage-root')
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        const manifest = await archiveStorage(
          [
            {
              destination: 'media',
              files: ['ab/cd.webp'],
              source: { kind: 'local', path: missingRoot }
            }
          ],
          tempDir,
          { allowMissingStorage: true }
        )

        expect(manifest).toEqual([
          expect.objectContaining({
            failedFiles: [{ error: 'copyfile ENOENT', path: 'ab/cd.webp' }]
          })
        ])
        expect(JSON.stringify(manifest)).not.toContain(missingRoot)
      } finally {
        logSpy.mockRestore()
        errorSpy.mockRestore()
      }
    })

    it('reports the status when the public storage fallback fails', async () => {
      // The one path that reaches `downloadPublicStorageFile`: the S3 client
      // throws and `source.hostname` is set, so the download falls back to a
      // plain HTTP GET. Its failure carries the status only as an attached
      // `httpStatusCode` — drop that attachment and this is the test that
      // notices, since the message it is also interpolated into is withheld.
      const sendSpy = vi
        .spyOn(S3Client.prototype, 'send')
        .mockImplementation((async () => {
          throw Object.assign(
            new Error('connect ECONNREFUSED 10.4.2.11:9000'),
            {
              code: 'ECONNREFUSED',
              syscall: 'connect'
            }
          )
        }) as typeof S3Client.prototype.send)
      const originalFetch = global.fetch
      global.fetch = vi.fn(
        async () => new Response('nope', { status: 503 })
      ) as typeof fetch
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        const manifest = await archiveStorage(
          [
            {
              destination: 'media',
              files: ['ab/cd.webp'],
              source: {
                bucket: 'activitynext-prod-media',
                hostname: 'cdn.internal',
                kind: 's3',
                region: 'auto'
              }
            }
          ],
          tempDir,
          { allowMissingStorage: true }
        )

        expect(global.fetch).toHaveBeenCalledWith(
          'https://cdn.internal/ab/cd.webp',
          expect.anything()
        )
        expect(manifest).toEqual([
          expect.objectContaining({
            failedFiles: [{ error: 'HTTP 503', path: 'ab/cd.webp' }]
          })
        ])
        expect(JSON.stringify(manifest)).not.toContain('cdn.internal')
      } finally {
        global.fetch = originalFetch
        sendSpy.mockRestore()
        logSpy.mockRestore()
        errorSpy.mockRestore()
      }
    })
  })

  describe('redactStorageError', () => {
    // `hostname` is a bare label on purpose: a Docker-network CDN host is the
    // one source value the shape check alone cannot tell from an error code.
    const source: StorageSource = {
      bucket: 'activitynext',
      endpoint: 'https://minio.internal:9000',
      hostname: 'minio',
      kind: 's3',
      region: 'auto'
    }

    it.each([
      {
        description: 'a DNS failure',
        error: Object.assign(
          new Error('getaddrinfo ENOTFOUND minio.internal'),
          { code: 'ENOTFOUND', syscall: 'getaddrinfo' }
        ),
        expected: 'getaddrinfo ENOTFOUND'
      },
      {
        description: 'an S3 service error',
        error: Object.assign(new Error('The specified key does not exist.'), {
          $metadata: { httpStatusCode: 404 },
          name: 'NoSuchKey'
        }),
        expected: 'NoSuchKey HTTP 404'
      },
      {
        description: 'a public storage response',
        error: Object.assign(
          new Error('Failed to download ab/cd.webp from public storage'),
          { httpStatusCode: 503 }
        ),
        expected: 'HTTP 503'
      },
      {
        description: 'a fetch failure behind its cause',
        error: Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('getaddrinfo EAI_AGAIN minio'), {
            code: 'EAI_AGAIN',
            syscall: 'getaddrinfo'
          })
        }),
        expected: 'getaddrinfo EAI_AGAIN'
      },
      {
        description: 'a wrapper with no coded cause',
        error: new TypeError('fetch failed'),
        expected: 'TypeError'
      },
      {
        description: 'an unclassified error',
        error: new Error('connection to minio.internal reset'),
        expected: 'unknown'
      },
      {
        description: 'a thrown non-error',
        error: 'minio.internal is unreachable',
        expected: 'unknown'
      },
      {
        description: 'a code shaped like a host',
        error: Object.assign(new Error('failed'), { code: 'minio.internal' }),
        expected: 'unknown'
      },
      {
        description: 'a code shaped like an address',
        error: Object.assign(new Error('failed'), { code: '10.4.2.11' }),
        expected: 'unknown'
      },
      {
        description: 'a name echoing the bucket',
        error: Object.assign(new Error('failed'), { name: 'activitynext' }),
        expected: 'unknown'
      },
      {
        description: 'a syscall echoing the CDN host',
        error: Object.assign(new Error('failed'), {
          code: 'ECONNRESET',
          syscall: 'minio'
        }),
        expected: 'ECONNRESET'
      },
      {
        description: 'an out-of-range status',
        error: Object.assign(new Error('failed'), { httpStatusCode: 9000 }),
        expected: 'unknown'
      }
    ])('redacts $description', ({ error, expected }) => {
      expect(redactStorageError(error, source)).toBe(expected)
    })

    it('terminates on a cause cycle', () => {
      const error = Object.assign(new Error('failed'), {
        cause: undefined as unknown
      })
      error.cause = error

      expect(redactStorageError(error, source)).toBe('unknown')
    })

    // Wrappers are plain `Error`, whose name is excluded, so `unknown` means
    // the walk never reached the coded level rather than that it read a name
    // on the way. Together these two pin `MAX_ERROR_CAUSE_DEPTH` in both
    // directions: lowering it fails the first, raising it fails the second.
    const buildCauseChain = (depth: number) => {
      let error: unknown = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
        code: 'ENOTFOUND',
        syscall: 'getaddrinfo'
      })
      for (let level = 1; level < depth; level += 1) {
        error = Object.assign(new Error('wrapped'), { cause: error })
      }
      return error
    }

    it('reads a code at the deepest level it walks', () => {
      expect(redactStorageError(buildCauseChain(5), source)).toBe(
        'getaddrinfo ENOTFOUND'
      )
    })

    it('stops one level past the cause cap', () => {
      expect(redactStorageError(buildCauseChain(6), source)).toBe('unknown')
    })

    it('falls back when reading the error throws', () => {
      const error = {}
      Object.defineProperty(error, 'code', {
        get() {
          throw new Error('boom')
        }
      })

      expect(redactStorageError(error, source)).toBe('unknown')
    })
  })
})
