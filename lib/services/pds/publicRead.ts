import { parseCid } from '@atproto/lex-data'
import {
  AtUri,
  isValidDid,
  isValidHandle,
  isValidNsid,
  isValidRecordKey,
  isValidTid
} from '@atproto/syntax'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import type { Database } from '@/lib/database/types'

import { readPdsBlob } from './blobs'
import type { PdsXrpcHandlerContext } from './dispatch'
import { PdsRecordNotFoundError } from './errors'
import { type PdsRateLimitBucket, checkPdsSyncRateLimit } from './rateLimit'
import {
  describePdsRepo,
  getPdsBlocksCarStream,
  getPdsLatestCommit,
  getPdsRecordProofCarStream,
  getPdsRecordValue,
  getPdsRepoCarStream,
  getPdsRepoStatus,
  listPdsBlobCids,
  listPdsRecordValues,
  listPdsRepos,
  resolvePdsRepoDidForDomain
} from './reads'
import {
  xrpcBlobResponse,
  xrpcCarResponse,
  xrpcErrorFromThrown,
  xrpcErrorResponse,
  xrpcJsonResponse,
  xrpcMethodNotImplementedResponse,
  xrpcRateLimitExceededResponse
} from './xrpc'

const MAX_GET_BLOCKS_CIDS = 100

const didSchema = z
  .string()
  .min(1, 'did is required')
  .refine((value) => isValidDid(value), 'Invalid DID')

const atIdentifierSchema = z
  .string()
  .min(1, 'repo is required')
  .refine(
    (value) => isValidDid(value) || isValidHandle(value),
    'Invalid repo identifier'
  )

const nsidSchema = z
  .string()
  .min(1, 'collection is required')
  .refine((value) => isValidNsid(value), 'Invalid collection NSID')

const rkeySchema = z
  .string()
  .min(1, 'rkey is required')
  .refine((value) => isValidRecordKey(value), 'Invalid record key')

const tidSchema = z
  .string()
  .min(1, 'Invalid TID')
  .refine((value) => isValidTid(value), 'Invalid TID')

const cidSchema = z
  .string()
  .min(1, 'cid is required')
  .refine((value) => {
    try {
      parseCid(value)
      return true
    } catch {
      return false
    }
  }, 'Invalid CID')

const cursorSchema = z.string().min(1, 'Invalid cursor').max(2048)

const intQueryParam = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'Must be an integer')
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isSafeInteger(value) && value >= min && value <= max,
      `Must be an integer between ${min} and ${max}`
    )

const booleanQueryParam = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')

const DescribeRepoQuery = z.object({
  repo: atIdentifierSchema
})

const GetRecordQuery = z.object({
  repo: atIdentifierSchema,
  collection: nsidSchema,
  rkey: rkeySchema,
  cid: cidSchema.optional()
})

const ListRecordsQuery = z.object({
  repo: atIdentifierSchema,
  collection: nsidSchema,
  limit: intQueryParam(1, 100).optional(),
  cursor: cursorSchema.optional(),
  reverse: booleanQueryParam.optional()
})

const SyncGetRepoQuery = z.object({
  did: didSchema,
  since: tidSchema.optional()
})

const SyncGetRecordQuery = z.object({
  did: didSchema,
  collection: nsidSchema,
  rkey: rkeySchema
})

const SyncGetBlocksQuery = z.object({
  did: didSchema,
  cids: z
    .array(cidSchema)
    .min(1, 'At least one CID is required')
    .max(MAX_GET_BLOCKS_CIDS, `At most ${MAX_GET_BLOCKS_CIDS} CIDs allowed`)
})

const SyncDidOnlyQuery = z.object({
  did: didSchema
})

const SyncListReposQuery = z.object({
  limit: intQueryParam(1, 1000).optional(),
  cursor: cursorSchema.optional()
})

const SyncListBlobsQuery = z.object({
  did: didSchema,
  since: tidSchema.optional(),
  limit: intQueryParam(1, 1000).optional(),
  cursor: cursorSchema.optional()
})

const SyncGetBlobQuery = z.object({
  did: didSchema,
  cid: cidSchema
})

const singleParam = (
  searchParams: URLSearchParams,
  name: string
): string | undefined => searchParams.get(name) ?? undefined

const invalidRequestFromZod = (error: z.ZodError, isHead: boolean): Response =>
  xrpcErrorResponse({
    error: 'InvalidRequest',
    message: error.issues[0]?.message ?? 'Invalid request parameters',
    status: 400,
    isHead
  })

const requireDatabase = (isHead: boolean): Database | Response => {
  const database = getDatabase()
  if (!database) {
    return xrpcErrorResponse({
      error: 'InternalServerError',
      message: 'Internal Server Error',
      status: 500,
      isHead
    })
  }
  return database
}

const getRateLimitBucket = (nsid: string): PdsRateLimitBucket | null => {
  if (nsid === 'com.atproto.sync.getBlob') return 'blob'
  if (nsid.startsWith('com.atproto.sync.')) return 'sync'
  if (nsid.startsWith('com.atproto.repo.')) return 'repo'
  return null
}

/**
 * Serves the `public-read` XRPC methods: the anonymous GET/HEAD reads a relay,
 * AppView or client makes against a hosted repo. The dispatch table decides
 * which NSIDs reach here; this switch is their implementation.
 */
export const handlePublicReadXrpc = async ({
  req,
  pdsDomain,
  nsid,
  isHead
}: PdsXrpcHandlerContext): Promise<Response> => {
  if (nsid === 'com.atproto.server.describeServer') {
    return xrpcJsonResponse(
      {
        did: pdsDomain.did,
        availableUserDomains: [],
        inviteCodeRequired: true
      },
      { isHead }
    )
  }

  const url = req.nextUrl ?? new URL(req.url)
  const { searchParams } = url

  const dbOrError = requireDatabase(isHead)
  if (dbOrError instanceof Response) {
    return dbOrError
  }
  const database = dbOrError

  try {
    const rateLimitBucket = getRateLimitBucket(nsid)
    if (rateLimitBucket) {
      const rateLimit = await checkPdsSyncRateLimit(
        database,
        req,
        rateLimitBucket
      )
      if (!rateLimit.allowed) {
        return xrpcRateLimitExceededResponse(
          rateLimit.retryAfterSeconds,
          isHead
        )
      }
    }

    switch (nsid) {
      case 'com.atproto.repo.describeRepo': {
        const parsed = DescribeRepoQuery.safeParse({
          repo: singleParam(searchParams, 'repo')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const did = await resolvePdsRepoDidForDomain(database, {
          repo: parsed.data.repo,
          domain: pdsDomain.domain
        })
        const description = await describePdsRepo(database, {
          did,
          domain: pdsDomain.domain
        })
        return xrpcJsonResponse(description, { isHead })
      }

      case 'com.atproto.repo.getRecord': {
        const parsed = GetRecordQuery.safeParse({
          repo: singleParam(searchParams, 'repo'),
          collection: singleParam(searchParams, 'collection'),
          rkey: singleParam(searchParams, 'rkey'),
          cid: singleParam(searchParams, 'cid')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const did = await resolvePdsRepoDidForDomain(database, {
          repo: parsed.data.repo,
          domain: pdsDomain.domain
        })
        const record = await getPdsRecordValue(database, {
          did,
          collection: parsed.data.collection,
          rkey: parsed.data.rkey,
          cid: parsed.data.cid,
          domain: pdsDomain.domain
        })
        if (!record) {
          throw new PdsRecordNotFoundError(
            AtUri.make(did, parsed.data.collection, parsed.data.rkey).toString()
          )
        }
        return xrpcJsonResponse(record, { isHead })
      }

      case 'com.atproto.repo.listRecords': {
        const parsed = ListRecordsQuery.safeParse({
          repo: singleParam(searchParams, 'repo'),
          collection: singleParam(searchParams, 'collection'),
          limit: singleParam(searchParams, 'limit'),
          cursor: singleParam(searchParams, 'cursor'),
          reverse: singleParam(searchParams, 'reverse')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const did = await resolvePdsRepoDidForDomain(database, {
          repo: parsed.data.repo,
          domain: pdsDomain.domain
        })
        const page = await listPdsRecordValues(database, {
          did,
          collection: parsed.data.collection,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
          reverse: parsed.data.reverse,
          domain: pdsDomain.domain
        })
        return xrpcJsonResponse(
          {
            records: page.records,
            ...(page.cursor !== undefined ? { cursor: page.cursor } : {})
          },
          { isHead }
        )
      }

      case 'com.atproto.sync.getRepo': {
        const parsed = SyncGetRepoQuery.safeParse({
          did: singleParam(searchParams, 'did'),
          since: singleParam(searchParams, 'since')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const stream = await getPdsRepoCarStream(database, {
          did: parsed.data.did,
          since: parsed.data.since,
          domain: pdsDomain.domain
        })
        return xrpcCarResponse(stream, { isHead })
      }

      case 'com.atproto.sync.getRecord': {
        const parsed = SyncGetRecordQuery.safeParse({
          did: singleParam(searchParams, 'did'),
          collection: singleParam(searchParams, 'collection'),
          rkey: singleParam(searchParams, 'rkey')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const stream = await getPdsRecordProofCarStream(database, {
          did: parsed.data.did,
          collection: parsed.data.collection,
          rkey: parsed.data.rkey,
          domain: pdsDomain.domain
        })
        return xrpcCarResponse(stream, { isHead })
      }

      case 'com.atproto.sync.getBlocks': {
        const cids = [
          ...searchParams.getAll('cids'),
          ...searchParams.getAll('cids[]')
        ]
        const parsed = SyncGetBlocksQuery.safeParse({
          did: singleParam(searchParams, 'did'),
          cids
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const stream = await getPdsBlocksCarStream(database, {
          did: parsed.data.did,
          cids: parsed.data.cids,
          domain: pdsDomain.domain
        })
        return xrpcCarResponse(stream, { isHead })
      }

      case 'com.atproto.sync.getLatestCommit': {
        const parsed = SyncDidOnlyQuery.safeParse({
          did: singleParam(searchParams, 'did')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const commit = await getPdsLatestCommit(database, {
          did: parsed.data.did,
          domain: pdsDomain.domain
        })
        return xrpcJsonResponse(commit, { isHead })
      }

      case 'com.atproto.sync.getRepoStatus': {
        const parsed = SyncDidOnlyQuery.safeParse({
          did: singleParam(searchParams, 'did')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const status = await getPdsRepoStatus(database, {
          did: parsed.data.did,
          domain: pdsDomain.domain
        })
        return xrpcJsonResponse(status, { isHead })
      }

      case 'com.atproto.sync.listRepos': {
        const parsed = SyncListReposQuery.safeParse({
          limit: singleParam(searchParams, 'limit'),
          cursor: singleParam(searchParams, 'cursor')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const page = await listPdsRepos(database, {
          domain: pdsDomain.domain,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit
        })
        return xrpcJsonResponse(
          {
            repos: page.repos,
            ...(page.cursor !== undefined ? { cursor: page.cursor } : {})
          },
          { isHead }
        )
      }

      case 'com.atproto.sync.listBlobs': {
        const parsed = SyncListBlobsQuery.safeParse({
          did: singleParam(searchParams, 'did'),
          since: singleParam(searchParams, 'since'),
          limit: singleParam(searchParams, 'limit'),
          cursor: singleParam(searchParams, 'cursor')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const page = await listPdsBlobCids(database, {
          did: parsed.data.did,
          since: parsed.data.since,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
          domain: pdsDomain.domain
        })
        return xrpcJsonResponse(
          {
            cids: page.cids,
            ...(page.cursor !== undefined ? { cursor: page.cursor } : {})
          },
          { isHead }
        )
      }

      case 'com.atproto.sync.getBlob': {
        const parsed = SyncGetBlobQuery.safeParse({
          did: singleParam(searchParams, 'did'),
          cid: singleParam(searchParams, 'cid')
        })
        if (!parsed.success) {
          return invalidRequestFromZod(parsed.error, isHead)
        }
        const blob = await readPdsBlob(database, {
          did: parsed.data.did,
          cid: parsed.data.cid,
          domain: pdsDomain.domain
        })
        if (!blob) {
          return xrpcErrorResponse({
            error: 'InvalidRequest',
            message: 'Blob not found',
            status: 400,
            isHead
          })
        }
        return xrpcBlobResponse({
          stream: blob.stream,
          mimeType: blob.mimeType,
          size: blob.size,
          isHead
        })
      }

      default:
        return xrpcMethodNotImplementedResponse(isHead)
    }
  } catch (error) {
    return xrpcErrorFromThrown(error, isHead)
  }
}
