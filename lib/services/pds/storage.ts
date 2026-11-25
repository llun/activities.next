import { type Cid, parseCid } from '@atproto/lex-data'
import {
  BlockMap,
  CidSet,
  type CommitData,
  ReadableBlockstore,
  type RepoStorage
} from '@atproto/repo'

import type { Database } from '@/lib/database/types'

/**
 * SQL-backed `@atproto/repo` blockstore for a single DID over `pds_blocks`.
 *
 * Reads check staged writes, then an in-memory block cache, then `pds_blocks`.
 * Mutations (`putBlock`, `putMany`, `updateRoot`, `applyCommit`) buffer in
 * memory so the caller persists them atomically inside a single database
 * commit transaction alongside `pds_repos`, `pds_records`, `pds_record_blobs`,
 * and `pds_events`.
 */
export class PdsSqlRepoStorage
  extends ReadableBlockstore
  implements RepoStorage
{
  private readonly cache = new BlockMap()
  private readonly stagedBlocks = new BlockMap()
  private readonly stagedRemovedCids = new CidSet()
  private stagedRoot: { cid: Cid; rev: string } | null = null

  constructor(
    private readonly database: Database,
    public readonly did: string
  ) {
    super()
  }

  async getRoot(): Promise<Cid | null> {
    const root = await this.getRootDetailed()
    return root ? root.cid : null
  }

  async getRootDetailed(): Promise<{ cid: Cid; rev: string } | null> {
    if (this.stagedRoot) {
      return this.stagedRoot
    }
    const repo = await this.database.getPdsRepo({ did: this.did })
    if (!repo?.rootCid || !repo.rev) {
      return null
    }
    return {
      cid: parseCid(repo.rootCid),
      rev: repo.rev
    }
  }

  /**
   * Proactively caches blocks written in `rev` to avoid per-node roundtrips
   * when walking the MST for a subsequent commit.
   */
  async cacheRev(rev: string): Promise<void> {
    const blocks = await this.database.getPdsBlocksByRev({
      did: this.did,
      repoRev: rev
    })
    for (const block of blocks) {
      this.cache.set(parseCid(block.cid), block.bytes)
    }
  }

  async getBytes(cid: Cid): Promise<Uint8Array | null> {
    const staged = this.stagedBlocks.get(cid)
    if (staged) return staged

    if (this.stagedRemovedCids.has(cid)) {
      return null
    }

    const cached = this.cache.get(cid)
    if (cached) return cached

    const rows = await this.database.getPdsBlocks({
      did: this.did,
      cids: [cid.toString()]
    })
    const found = rows[0]
    if (!found) return null

    this.cache.set(cid, found.bytes)
    return found.bytes
  }

  async has(cid: Cid): Promise<boolean> {
    if (this.stagedBlocks.has(cid)) return true
    if (this.stagedRemovedCids.has(cid)) return false
    if (this.cache.has(cid)) return true
    return (await this.getBytes(cid)) !== null
  }

  async getBlocks(cids: Cid[]): Promise<{ blocks: BlockMap; missing: Cid[] }> {
    const blocks = new BlockMap()
    const unresolved: Cid[] = []

    for (const cid of cids) {
      const staged = this.stagedBlocks.get(cid)
      if (staged) {
        blocks.set(cid, staged)
        continue
      }
      if (this.stagedRemovedCids.has(cid)) {
        unresolved.push(cid)
        continue
      }
      const cached = this.cache.get(cid)
      if (cached) {
        blocks.set(cid, cached)
        continue
      }
      unresolved.push(cid)
    }

    if (unresolved.length === 0) {
      return { blocks, missing: [] }
    }

    const missing = new CidSet(unresolved)
    const toFetch = unresolved.filter((cid) => !this.stagedRemovedCids.has(cid))
    if (toFetch.length > 0) {
      const rows = await this.database.getPdsBlocks({
        did: this.did,
        cids: toFetch.map((cid) => cid.toString())
      })
      for (const row of rows) {
        const cid = parseCid(row.cid)
        this.cache.set(cid, row.bytes)
        blocks.set(cid, row.bytes)
        missing.delete(cid)
      }
    }

    return { blocks, missing: missing.toList() }
  }

  async putBlock(cid: Cid, block: Uint8Array, _rev: string): Promise<void> {
    this.stagedBlocks.set(cid, block)
    this.cache.set(cid, block)
    this.stagedRemovedCids.delete(cid)
  }

  async putMany(toPut: BlockMap, _rev: string): Promise<void> {
    this.stagedBlocks.addMap(toPut)
    this.cache.addMap(toPut)
    for (const cid of toPut.cids()) {
      this.stagedRemovedCids.delete(cid)
    }
  }

  async updateRoot(cid: Cid, rev: string): Promise<void> {
    this.stagedRoot = { cid, rev }
  }

  async applyCommit(commit: CommitData): Promise<void> {
    await this.updateRoot(commit.cid, commit.rev)
    await this.putMany(commit.newBlocks, commit.rev)
    for (const removedCid of commit.removedCids.toList()) {
      if (!this.stagedBlocks.has(removedCid)) {
        this.stagedRemovedCids.add(removedCid)
        this.cache.delete(removedCid)
      }
    }
  }

  getStagedBlocks(): BlockMap {
    return this.stagedBlocks
  }

  getStagedRoot(): { cid: Cid; rev: string } | null {
    return this.stagedRoot
  }
}

/**
 * Non-caching, read-only SQL blockstore over `pds_blocks` for a single DID.
 *
 * Used by streaming read paths (`sync.getRepo`, `sync.getBlocks`,
 * `sync.getRecord`) so walking or streaming a large repository never retains
 * fetched blocks in an unbounded in-memory cache.
 */
export class PdsReadOnlyRepoStorage extends ReadableBlockstore {
  constructor(
    private readonly database: Database,
    public readonly did: string
  ) {
    super()
  }

  async getBytes(cid: Cid): Promise<Uint8Array | null> {
    const rows = await this.database.getPdsBlocks({
      did: this.did,
      cids: [cid.toString()]
    })
    return rows[0]?.bytes ?? null
  }

  async has(cid: Cid): Promise<boolean> {
    const sizes = await this.database.getPdsBlockSizes({
      did: this.did,
      cids: [cid.toString()]
    })
    return sizes.length > 0
  }

  async getBlocks(cids: Cid[]): Promise<{ blocks: BlockMap; missing: Cid[] }> {
    const blocks = new BlockMap()
    if (cids.length === 0) {
      return { blocks, missing: [] }
    }

    const missing = new CidSet(cids)
    const rows = await this.database.getPdsBlocks({
      did: this.did,
      cids: cids.map((cid) => cid.toString())
    })
    for (const row of rows) {
      const cid = parseCid(row.cid)
      blocks.set(cid, row.bytes)
      missing.delete(cid)
    }

    return { blocks, missing: missing.toList() }
  }
}
