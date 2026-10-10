// Parameter and result types of the admin domain (account and hashtag listings,
// service statistics, and the domain block and allow rules).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import { z } from 'zod'

import type { Account } from '@/lib/types/domain/account'
import type { Actor } from '@/lib/types/domain/actor'

export type GetAllAccountsParams = {
  limit: number
  offset: number
}

export type GetAllAccountsResult = {
  accounts: Account[]
  total: number
}

export type GetAccountWithActorsParams = {
  accountId: string
}

export type GetAccountWithActorsResult = {
  account: Account
  actors: Actor[]
}

export interface ServiceStats {
  totalAccounts: number
  totalActors: number
  totalStatuses: number
  totalMediaFiles: number
  totalMediaBytes: number
  totalFitnessFiles: number
  totalFitnessBytes: number
}

export interface ServiceStatsBucket {
  bucketHour: number
  value: number
}

export type ServiceStatCounterType =
  | 'accounts'
  | 'actors'
  | 'statuses'
  | 'media-files'
  | 'media-bytes'
  | 'fitness-files'
  | 'fitness-bytes'

export const ALL_COUNTER_TYPES: ServiceStatCounterType[] = [
  'accounts',
  'actors',
  'statuses',
  'media-files',
  'media-bytes',
  'fitness-files',
  'fitness-bytes'
]

/** Max allowed time window for bucket queries (91 days) */
export const MAX_STATS_WINDOW_MS = 91 * 24 * 60 * 60 * 1000

export interface GetServiceStatsBucketsParams {
  counterType: ServiceStatCounterType
  startTime: number
  endTime: number
}

export type HashtagSortOrder = 'alphabetical' | 'recent' | 'count'

export interface AdminHashtag {
  name: string
  postCount: number
  latestPostAt: number | null
}

export interface GetAllHashtagsParams {
  limit: number
  offset: number
  sort: HashtagSortOrder
}

export interface GetAllHashtagsResult {
  hashtags: AdminHashtag[]
  total: number
}

export const DomainFederationRuleType = z.enum(['block', 'allow'])
export type DomainFederationRuleType = z.infer<typeof DomainFederationRuleType>

export const DomainBlockSeverity = z.enum(['noop', 'silence', 'suspend'])
export type DomainBlockSeverity = z.infer<typeof DomainBlockSeverity>

export interface DomainFederationRule {
  id: string
  domain: string
  type: DomainFederationRuleType
  createdAt: number
  updatedAt: number
}

export interface DomainBlock extends DomainFederationRule {
  type: 'block'
  severity: DomainBlockSeverity
  rejectMedia: boolean
  rejectReports: boolean
  privateComment: string | null
  publicComment: string | null
  obfuscate: boolean
  source: string | null
}

export interface DomainAllow extends DomainFederationRule {
  type: 'allow'
}

export type ListDomainFederationRulesParams = {
  type: DomainFederationRuleType
  limit?: number
  offset?: number
}

export type GetDomainBlocksParams = {
  limit?: number
  offset?: number
  severities?: DomainBlockSeverity[]
  // Cursor pagination over the domain-ascending order (cursor = row id):
  // maxId pages forward, minId returns the page immediately before the
  // cursor, sinceId returns the top-of-list rows before the cursor. Any
  // cursor disables offset.
  maxId?: string
  minId?: string
  sinceId?: string
}

export type GetDomainAllowsParams = {
  limit?: number
  offset?: number
  maxId?: string
  minId?: string
  sinceId?: string
}

export type CreateDomainBlockParams = {
  domain: string
  severity?: DomainBlockSeverity
  rejectMedia?: boolean
  rejectReports?: boolean
  privateComment?: string | null
  publicComment?: string | null
  obfuscate?: boolean
  source?: string | null
}

export type UpdateDomainBlockParams = {
  id: string
  severity?: DomainBlockSeverity
  rejectMedia?: boolean
  rejectReports?: boolean
  privateComment?: string | null
  publicComment?: string | null
  obfuscate?: boolean
  source?: string | null
}

export type CreateDomainAllowParams = {
  domain: string
}

export type ImportDomainBlockParams = CreateDomainBlockParams

export type ImportDomainBlocksParams = {
  blocks: ImportDomainBlockParams[]
}

export type ImportDomainBlocksResult = {
  created: number
  updated: number
  skipped: number
}

export type DomainFederationRuleStats = {
  blocks: number
  suspendBlocks: number
  silenceBlocks: number
  allows: number
  sourceBlocks: number
  sourceCounts: Record<string, number>
}

export interface AdminDatabase {
  getAllAccounts(params: GetAllAccountsParams): Promise<GetAllAccountsResult>
  getAccountWithActors(
    params: GetAccountWithActorsParams
  ): Promise<GetAccountWithActorsResult | null>
  getServiceStats(): Promise<ServiceStats>
  getServiceStatsBuckets(
    params: GetServiceStatsBucketsParams
  ): Promise<ServiceStatsBucket[]>
  getAllHashtags(params: GetAllHashtagsParams): Promise<GetAllHashtagsResult>
  getDomainBlocks(params?: GetDomainBlocksParams): Promise<DomainBlock[]>
  getDomainAllows(params?: GetDomainAllowsParams): Promise<DomainAllow[]>
  getDomainBlockById(id: string): Promise<DomainBlock | null>
  getDomainAllowById(id: string): Promise<DomainAllow | null>
  getDomainBlockForDomain(domain: string): Promise<DomainBlock | null>
  getDomainAllowForDomain(domain: string): Promise<DomainAllow | null>
  getDomainBlocksForDomains(
    domains: string[]
  ): Promise<Record<string, DomainBlock | null>>
  getDomainAllowsForDomains(
    domains: string[]
  ): Promise<Record<string, DomainAllow | null>>
  getDomainFederationRuleStats(): Promise<DomainFederationRuleStats>
  createDomainBlock(params: CreateDomainBlockParams): Promise<DomainBlock>
  updateDomainBlock(
    params: UpdateDomainBlockParams
  ): Promise<DomainBlock | null>
  deleteDomainBlock(id: string): Promise<DomainBlock | null>
  createDomainAllow(params: CreateDomainAllowParams): Promise<DomainAllow>
  deleteDomainAllow(id: string): Promise<DomainAllow | null>
  importDomainBlocks(
    params: ImportDomainBlocksParams
  ): Promise<ImportDomainBlocksResult>
}
