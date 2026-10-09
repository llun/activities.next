/**
 * How an admin table fits a phone. Below `sm` only the primary column stays a
 * column; the secondary ones (`SECONDARY_COLUMN_CLASS`, on both the header and
 * the body cell) drop out and their values are folded into a muted second line
 * under the primary cell (`PHONE_DETAIL_CLASS`, hidden from `sm` up), so
 * nothing essential sits off-screen behind a sideways scroll. Both are
 * `display: none` when they do not apply, so a screen reader reads each value
 * once.
 */
export const SECONDARY_COLUMN_CLASS = 'hidden sm:table-cell'

export const PHONE_DETAIL_CLASS =
  'text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:hidden'
