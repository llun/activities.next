import { isValidNsid } from '@atproto/syntax'
import { z } from 'zod'

import {
  getBlueskyAppViewDid,
  getBlueskyAppViewUrl,
  getPdsConfig
} from '@/lib/config/blueskyPds'
import type { BlueskyAccount } from '@/lib/database/domains/blueskyAccount/types'
import type { PdsRepoStatus } from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'
import {
  type BlueskyAgent,
  BlueskyHostedAccountInactiveError,
  type BlueskyQueryParams,
  BlueskyRequestError,
  BlueskyUnexpectedAnswerError,
  buildPath,
  readXrpcError
} from '@/lib/services/bluesky/agent'
import type { Actor } from '@/lib/types/domain/actor'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import { uploadPdsBlob } from './blobs'
import { resolveEffectivePdsRepoStatus } from './effectiveStatus'
import {
  PdsDisabledError,
  PdsError,
  PdsRepoNotFoundError,
  PdsRepoUnavailableError
} from './errors'
import { getHostedPdsUrl } from './host'
import { loadPdsSigningKey } from './keys'
import type { PdsWriteInput } from './prepare'
import {
  describePdsRepo,
  getPdsRecordValue,
  listPdsRecordValues
} from './reads'
import {
  applyPdsWrites,
  createPdsRecord,
  deletePdsRecord,
  putPdsRecord
} from './repo'
import { createServiceAuthToken } from './serviceAuth'

// The Bluesky client of a hosted account (D2.3b): the BlueskyAgent the app's
// Bluesky features use, answered in process. Repo writes, blobs, reads of the
// account's own repo and its preferences go to the embedded PDS; every other
// `app.bsky.*` call goes to the AppView with a service-auth token, the way an
// outside PDS proxies them.

const APPVIEW_MAX_BODY_BYTES = 2 * 1024 * 1024
const APPVIEW_TIMEOUT_MS = 10_000

const RecordInput = z.record(z.string(), z.unknown())
const CreateRecordBody = z.object({
  repo: z.string(),
  collection: z.string(),
  rkey: z.string().optional(),
  record: RecordInput,
  swapCommit: z.string().optional()
})
const PutRecordBody = CreateRecordBody.extend({ rkey: z.string() })
const DeleteRecordBody = z.object({
  repo: z.string(),
  collection: z.string(),
  rkey: z.string(),
  swapCommit: z.string().optional()
})
const ApplyWritesBody = z.object({
  repo: z.string(),
  swapCommit: z.string().optional(),
  writes: z
    .discriminatedUnion('$type', [
      z.object({
        $type: z.literal('com.atproto.repo.applyWrites#create'),
        collection: z.string(),
        rkey: z.string().optional(),
        value: RecordInput
      }),
      z.object({
        $type: z.literal('com.atproto.repo.applyWrites#update'),
        collection: z.string(),
        rkey: z.string(),
        value: RecordInput
      }),
      z.object({
        $type: z.literal('com.atproto.repo.applyWrites#delete'),
        collection: z.string(),
        rkey: z.string()
      })
    ])
    .array()
})
const PutPreferencesBody = z.object({ preferences: z.unknown().array() })
const GetRecordParams = z.object({
  repo: z.string(),
  collection: z.string(),
  rkey: z.string(),
  cid: z.string().optional()
})
const ListRecordsParams = z.object({
  repo: z.string(),
  collection: z.string(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  reverse: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional()
})
const DescribeRepoParams = z.object({ repo: z.string() })

const invalidRequest = (nsid: string, message: string) =>
  new BlueskyRequestError(nsid, 400, 'InvalidRequest', message)

const parseInput = <T>(nsid: string, schema: z.ZodType<T>, input: unknown) => {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw invalidRequest(nsid, parsed.error.issues[0]?.message ?? 'Invalid')
  }
  return parsed.data
}

// Only a repo its owner turned off (stored `deactivated`) says "turn it on";
// an account-level block is effective `deactivated` over an active repo.
const inactiveReason = (status: PdsRepoStatus, storedStatus?: PdsRepoStatus) =>
  status === 'deactivated'
    ? storedStatus === 'deactivated'
      ? 'off'
      : 'unavailable'
    : status === 'deleted'
      ? 'gone'
      : 'takendown'

// A local PDS failure, answered as an outside PDS would: a repo that is off,
// gone, or on a domain whose PDS is off ends the session like a revoked one.
const mapLocalError = (nsid: string, error: unknown): unknown => {
  if (error instanceof PdsRepoUnavailableError) {
    return new BlueskyHostedAccountInactiveError(
      inactiveReason(error.repoStatus)
    )
  }
  if (
    error instanceof PdsRepoNotFoundError ||
    error instanceof PdsDisabledError
  ) {
    return new BlueskyHostedAccountInactiveError('gone')
  }
  if (error instanceof PdsError) {
    return new BlueskyRequestError(
      nsid,
      error.statusCode,
      error.code,
      error.message
    )
  }
  return error
}

/**
 * The BlueskyAgent of the hosted account `account` (authType `hosted`). Every
 * call first re-reads the repo and the actor, and throws
 * BlueskyHostedAccountInactiveError (a BlueskySessionEndedError) unless the
 * repo's effective status is active.
 */
export const createHostedBlueskyAgent = async (
  database: Database,
  actor: Actor,
  account: BlueskyAccount
): Promise<BlueskyAgent> => {
  const { did } = account
  const initial = await database.getPdsRepo({ did })
  const pdsUrl = (initial && getHostedPdsUrl(initial)) ?? account.pdsUrl

  const assertActive = async () => {
    const repo = await database.getPdsRepo({ did })
    if (
      !repo ||
      repo.actorId !== actor.id ||
      !getPdsConfig()?.[repo.domain]?.enabled
    ) {
      throw new BlueskyHostedAccountInactiveError('gone')
    }
    const current = await database.getActorFromId({ id: actor.id })
    const status = resolveEffectivePdsRepoStatus(repo, current)
    if (status !== 'active') {
      throw new BlueskyHostedAccountInactiveError(
        inactiveReason(status, repo.status)
      )
    }
  }

  const local = async <T>(nsid: string, run: () => Promise<T>): Promise<T> => {
    await assertActive()
    try {
      return await run()
    } catch (error) {
      throw mapLocalError(nsid, error)
    }
  }

  const requireOwnRepo = (nsid: string, repo: string) => {
    if (repo !== did) {
      throw invalidRequest(nsid, `Only ${did} is hosted on this client`)
    }
  }

  const appView = async <T>(
    nsid: string,
    request:
      | { method: 'GET'; params?: BlueskyQueryParams }
      | {
          method: 'POST'
          body: unknown
        }
  ): Promise<T> => {
    // Before a token is minted: the method name goes into the URL and `lxm`.
    if (!isValidNsid(nsid)) throw invalidRequest(nsid, 'Invalid method name')
    await assertActive()
    const encrypted = await database.getPdsRepoSigningKey({ did })
    if (!encrypted) throw new BlueskyHostedAccountInactiveError('gone')
    const keypair = await loadPdsSigningKey({ did, signingKey: encrypted })
    const token = await createServiceAuthToken({
      keypair,
      iss: did,
      // The DID the AppView answers as; the `#bsky_appview` fragment names
      // its service entry, not part of the audience.
      aud: getBlueskyAppViewDid().split('#')[0],
      lxm: nsid
    })
    const body =
      request.method === 'POST' ? JSON.stringify(request.body ?? {}) : undefined
    const result = await safeRemoteFetch({
      url: new URL(
        buildPath(nsid, request.method === 'GET' ? request.params : undefined),
        getBlueskyAppViewUrl()
      ).href,
      method: request.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body } : {}),
      maxRedirects: 0,
      maxBodyBytes: APPVIEW_MAX_BODY_BYTES,
      timeoutInMilliseconds: APPVIEW_TIMEOUT_MS
    })
    if (result.statusCode < 200 || result.statusCode >= 300) {
      const { error, message } = readXrpcError(result.body)
      throw new BlueskyRequestError(nsid, result.statusCode, error, message)
    }
    if (!result.body) return undefined as T
    try {
      return JSON.parse(result.body) as T
    } catch {
      throw new BlueskyUnexpectedAnswerError(nsid)
    }
  }

  const unsupported = (nsid: string) =>
    new BlueskyRequestError(
      nsid,
      501,
      'MethodNotImplemented',
      `${nsid} is not available to a Bluesky account hosted on this server`
    )

  const post = async (nsid: string, input: unknown): Promise<unknown> => {
    switch (nsid) {
      case 'com.atproto.repo.createRecord': {
        const body = parseInput(nsid, CreateRecordBody, input)
        requireOwnRepo(nsid, body.repo)
        const { uri, cid, commit } = await local(nsid, () =>
          createPdsRecord(database, {
            did,
            collection: body.collection,
            rkey: body.rkey,
            record: body.record,
            swapCommit: body.swapCommit
          })
        )
        return { uri, cid, commit }
      }
      case 'com.atproto.repo.putRecord': {
        const body = parseInput(nsid, PutRecordBody, input)
        requireOwnRepo(nsid, body.repo)
        const { uri, cid, commit } = await local(nsid, () =>
          putPdsRecord(database, {
            did,
            collection: body.collection,
            rkey: body.rkey,
            record: body.record,
            swapCommit: body.swapCommit
          })
        )
        return { uri, cid, ...(commit ? { commit } : {}) }
      }
      case 'com.atproto.repo.deleteRecord': {
        const body = parseInput(nsid, DeleteRecordBody, input)
        requireOwnRepo(nsid, body.repo)
        const { commit } = await local(nsid, () =>
          deletePdsRecord(database, {
            did,
            collection: body.collection,
            rkey: body.rkey,
            swapCommit: body.swapCommit
          })
        )
        return commit ? { commit } : {}
      }
      case 'com.atproto.repo.applyWrites': {
        const body = parseInput(nsid, ApplyWritesBody, input)
        requireOwnRepo(nsid, body.repo)
        const writes: PdsWriteInput[] = body.writes.map((write) =>
          write.$type === 'com.atproto.repo.applyWrites#delete'
            ? {
                action: 'delete',
                collection: write.collection,
                rkey: write.rkey
              }
            : write.$type === 'com.atproto.repo.applyWrites#update'
              ? {
                  action: 'update',
                  collection: write.collection,
                  rkey: write.rkey,
                  record: write.value
                }
              : {
                  action: 'create',
                  collection: write.collection,
                  rkey: write.rkey,
                  record: write.value
                }
        )
        const { commit, results } = await local(nsid, () =>
          applyPdsWrites(database, { did, writes, swapCommit: body.swapCommit })
        )
        return {
          commit,
          results: results.map((result) =>
            result.action === 'delete'
              ? { $type: 'com.atproto.repo.applyWrites#deleteResult' }
              : {
                  $type: `com.atproto.repo.applyWrites#${result.action}Result`,
                  uri: result.uri,
                  cid: result.cid
                }
          )
        }
      }
      case 'app.bsky.actor.putPreferences': {
        const { preferences } = parseInput(nsid, PutPreferencesBody, input)
        await local(nsid, () =>
          database.putPdsPreferences({ did, preferences })
        )
        return undefined
      }
    }
    if (nsid.startsWith('app.bsky.')) {
      return appView(nsid, { method: 'POST', body: input })
    }
    throw unsupported(nsid)
  }

  const get = async (
    nsid: string,
    params: BlueskyQueryParams = {}
  ): Promise<unknown> => {
    switch (nsid) {
      case 'com.atproto.repo.getRecord': {
        const query = parseInput(nsid, GetRecordParams, params)
        requireOwnRepo(nsid, query.repo)
        const record = await local(nsid, () =>
          getPdsRecordValue(database, {
            did,
            collection: query.collection,
            rkey: query.rkey,
            cid: query.cid
          })
        )
        if (!record) {
          throw new BlueskyRequestError(
            nsid,
            400,
            'RecordNotFound',
            `Could not locate record: at://${did}/${query.collection}/${query.rkey}`
          )
        }
        return record
      }
      case 'com.atproto.repo.listRecords': {
        const query = parseInput(nsid, ListRecordsParams, params)
        requireOwnRepo(nsid, query.repo)
        const page = await local(nsid, () =>
          listPdsRecordValues(database, {
            did,
            collection: query.collection,
            limit: query.limit,
            cursor: query.cursor,
            reverse: query.reverse
          })
        )
        return {
          records: page.records,
          ...(page.cursor !== undefined ? { cursor: page.cursor } : {})
        }
      }
      case 'com.atproto.repo.describeRepo': {
        const query = parseInput(nsid, DescribeRepoParams, params)
        requireOwnRepo(nsid, query.repo)
        return local(nsid, () => describePdsRepo(database, { did }))
      }
      case 'app.bsky.actor.getPreferences': {
        const preferences = await local(nsid, () =>
          database.getPdsPreferences({ did })
        )
        return { preferences: preferences ?? [] }
      }
    }
    if (nsid.startsWith('app.bsky.')) {
      return appView(nsid, { method: 'GET', params })
    }
    throw unsupported(nsid)
  }

  return {
    did,
    pdsUrl,
    get: async <T>(nsid: string, params?: BlueskyQueryParams) =>
      (await get(nsid, params)) as T,
    post: async <T>(nsid: string, body: unknown) =>
      (await post(nsid, body)) as T,
    uploadBlob: async (bytes, mimeType) => {
      const nsid = 'com.atproto.repo.uploadBlob'
      const result = await local(nsid, () =>
        uploadPdsBlob(database, { did, bytes, mimeType })
      )
      return {
        $type: 'blob',
        ref: { $link: result.cid },
        mimeType: result.mimeType,
        size: result.size
      }
    }
  }
}
