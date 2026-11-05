export const DELIVERY_FAILURE_DAYS_THRESHOLD = 7
export const MAX_DELIVERY_LAST_ERROR_LENGTH = 255
// After 24 hours without a failure, allow deliveries to probe the inbox again.
export const DELIVERY_UNAVAILABLE_PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000

export type RecordDeliveryFailureParams = {
  inbox: string
  error?: string | null
  now?: number | Date
}

export type ClearDeliveryFailuresParams = {
  inbox: string
}

export type ClearDeliveryFailuresForDomainParams = {
  domain: string
}

export type GetUnavailableInboxesParams = {
  inboxes: string[]
  now?: number | Date
}

export type IsInboxUnavailableParams = {
  inbox: string
  now?: number | Date
}

export interface DeliveryInboxesDatabase {
  recordDeliveryFailure(params: RecordDeliveryFailureParams): Promise<boolean>
  clearDeliveryFailures(params: ClearDeliveryFailuresParams): Promise<void>
  clearDeliveryFailuresForDomain(
    params: ClearDeliveryFailuresForDomainParams
  ): Promise<void>
  getUnavailableInboxes(params: GetUnavailableInboxesParams): Promise<string[]>
  isInboxUnavailable(params: IsInboxUnavailableParams): Promise<boolean>
}
