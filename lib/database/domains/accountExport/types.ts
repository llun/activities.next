// Parameter and result types of the account export reader domain: read-only,
// keyset-paged access to the per-actor rows the account archive writes out.
//
// Every table is listed with an explicit column allowlist (see ./tables.ts), so
// a secret column (keys, tokens, OAuth secrets, push endpoints) can never reach
// an archive by being added to a table later.

export type AccountExportTableName =
  | 'follows'
  | 'followers'
  | 'mutes'
  | 'bookmarks'
  | 'blocks'
  | 'actor_domain_blocks'
  | 'account_notes'
  | 'endorsements'
  | 'featured_tags'
  | 'followed_tags'
  | 'lists'
  | 'list_accounts'
  | 'filters'
  | 'filter_keywords'
  | 'filter_statuses'
  | 'status_pins'
  | 'status_reactions'
  | 'poll_answers'
  | 'scheduled_statuses'
  | 'medias'
  | 'media_edit_files'
  | 'gallery_albums'
  | 'gallery_album_items'
  | 'gallery_gears'
  | 'gallery_settings'
  | 'fitness_gears'
  | 'fitness_gear_components'
  | 'fitness_gear_component_periods'
  | 'fitness_settings'

/** A keyset cursor: the sort-key values of the last row of the previous page. */
export type AccountExportCursor = (string | number)[]

export type GetAccountExportRowsParams = {
  table: AccountExportTableName
  actorId: string
  after?: AccountExportCursor | null
  limit: number
}

export type AccountExportRows = {
  rows: Record<string, unknown>[]
  /** Pass as `after` for the next page; null when this was the last page. */
  next: AccountExportCursor | null
}

/** The non-secret part of an account. */
export type AccountExportAccount = {
  id: string
  email: string
  name: string | null
  signUpDomain: string | null
  defaultActorId: string | null
  createdAt: number
  verifiedAt: number | null
  emailVerifiedAt: number | null
}

/** An actor of the account with its settings JSON parsed (never its keys). */
export type AccountExportActor = {
  id: string
  publicId: string | null
  username: string
  domain: string
  name: string | null
  summary: string | null
  type: string
  createdAt: number
  settings: Record<string, unknown>
}

export type GetAccountExportAccountParams = { accountId: string }
export type GetAccountExportActorsParams = { accountId: string }

export type OwnsAccountExportMediaPathParams = {
  accountId: string
  path: string
}

export interface AccountExportDatabase {
  /**
   * Whether `path` is the original or thumbnail of a media row of one of the
   * account's actors (a profile image URL is free text, so it is checked).
   */
  ownsAccountExportMediaPath(
    params: OwnsAccountExportMediaPathParams
  ): Promise<boolean>
  getAccountExportAccount(
    params: GetAccountExportAccountParams
  ): Promise<AccountExportAccount | null>
  /** Every actor of the account, oldest first. */
  getAccountExportActors(
    params: GetAccountExportActorsParams
  ): Promise<AccountExportActor[]>
  getAccountExportRows(
    params: GetAccountExportRowsParams
  ): Promise<AccountExportRows>
}
