// Parameter and result types of the instanceRule domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// A moderation rule shown on the instance's about page and returned from
// GET /api/v1/instance/rules. `position` drives the display order (ascending,
// with `createdAt` as a stable tiebreaker); `hint` is the optional longer
// explanation Mastodon 4.3+ renders under the rule. `createdAt`/`updatedAt`
// are epoch milliseconds in the domain shape regardless of the backend's
// timestamp storage. `domain` is the served domain a rule is for; null is a
// server rule, which applies on every domain. `position` orders rules within
// their own scope (server rules, or one domain's).
export type InstanceRuleData = {
  id: string
  domain: string | null
  position: number
  text: string
  hint: string
  createdAt: number
  updatedAt: number
}

export type CreateInstanceRuleParams = {
  // Null or absent: a server rule.
  domain?: string | null
  text: string
  hint: string
  position?: number
}
export type UpdateInstanceRuleParams = {
  id: string
  text?: string
  hint?: string
  position?: number
}
export type DeleteInstanceRuleParams = { id: string }
export type GetInstanceRuleParams = { id: string }
export type GetInstanceRulesParams = {
  // The visited domain: its own rules follow the server rules. Null or absent
  // returns the server rules only.
  domain?: string | null
}
export type GetOwnInstanceRulesParams = {
  // The scope to list: a domain's own rules, or null for the server rules.
  domain: string | null
}

export interface InstanceRuleDatabase {
  createInstanceRule(
    params: CreateInstanceRuleParams
  ): Promise<InstanceRuleData>
  // Partial update; bumps updatedAt and returns the updated row, or null when
  // the rule does not exist.
  updateInstanceRule(
    params: UpdateInstanceRuleParams
  ): Promise<InstanceRuleData | null>
  // True when a row was removed.
  deleteInstanceRule(params: DeleteInstanceRuleParams): Promise<boolean>
  // The rules a visitor to a domain sees: the server rules (domain null), then
  // the domain's own rules, each group ordered by position ascending, then
  // createdAt ascending.
  getInstanceRules(params?: GetInstanceRulesParams): Promise<InstanceRuleData[]>
  // Exactly one scope, in that order: a domain's own rules, or (null) the
  // server rules.
  getOwnInstanceRules(
    params: GetOwnInstanceRulesParams
  ): Promise<InstanceRuleData[]>
  // Every rule of every scope (server rules, then by domain), for resolving
  // the rule ids a stored report cites.
  getAllInstanceRules(): Promise<InstanceRuleData[]>
  // One rule by id, or null.
  getInstanceRule(
    params: GetInstanceRuleParams
  ): Promise<InstanceRuleData | null>
}
