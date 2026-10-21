// The open-report count is read from one capped page of the queue: one more
// than the limit is fetched, so exactly the limit shows as is and anything
// past it shows as "<limit>+".
export const OPEN_REPORTS_LIMIT = 1000

export const OPEN_REPORTS_FETCH_LIMIT = OPEN_REPORTS_LIMIT + 1

export const countOpenReports = (
  fetched: number
): { count: number; capped: boolean } => ({
  count: Math.min(fetched, OPEN_REPORTS_LIMIT),
  capped: fetched > OPEN_REPORTS_LIMIT
})
