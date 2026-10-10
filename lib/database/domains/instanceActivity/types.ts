// Parameter and result types of the instance activity domain (weekly activity
// from the bucket counters, federation peers and the contact account).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export interface InstanceActivityWeek {
  week: string
  statuses: string
  logins: string
  registrations: string
}

export interface GetInstanceActivityParams {
  now?: Date
}

export interface InstanceActivityDatabase {
  getInstanceActivity(
    params?: GetInstanceActivityParams
  ): Promise<InstanceActivityWeek[]>
  getInstancePeers(params?: GetInstancePeersParams): Promise<string[]>
  // Earliest-created local actor owned by an account with the admin role,
  // used as the Mastodon instance contact account; null when the instance
  // has no admin.
  getInstanceAdminActorId(): Promise<string | null>
}

export type GetInstancePeersParams = {
  localDomain: string
}
