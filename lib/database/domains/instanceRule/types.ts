// Parameter and result types of the instanceRule domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// A moderation rule shown on the instance's about page and returned from
// GET /api/v1/instance/rules. `position` drives the display order (ascending,
// with `createdAt` as a stable tiebreaker); `hint` is the optional longer
// explanation Mastodon 4.3+ renders under the rule. `createdAt`/`updatedAt`
// are epoch milliseconds in the domain shape regardless of the backend's
// timestamp storage.
export type InstanceRuleData = {
  id: string
  position: number
  text: string
  hint: string
  createdAt: number
  updatedAt: number
}

export type CreateInstanceRuleParams = {
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
  // All rules ordered by position ascending, then createdAt ascending.
  getInstanceRules(): Promise<InstanceRuleData[]>
}
