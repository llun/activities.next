export const PDS_FIREHOSE_MAX_CONNECTIONS_PER_PROCESS = 100
export const PDS_FIREHOSE_MAX_CONNECTIONS_PER_CLIENT = 5

export interface PdsFirehoseConnectionLimiterOptions {
  maxPerProcess?: number
  maxPerClient?: number
}

export interface PdsFirehoseConnectionLimiter {
  tryAcquire(clientKey: string | null): (() => void) | null
  getActiveCount(): number
  getClientActiveCount(clientKey: string): number
}

export const createPdsFirehoseConnectionLimiter = ({
  maxPerProcess = PDS_FIREHOSE_MAX_CONNECTIONS_PER_PROCESS,
  maxPerClient = PDS_FIREHOSE_MAX_CONNECTIONS_PER_CLIENT
}: PdsFirehoseConnectionLimiterOptions = {}): PdsFirehoseConnectionLimiter => {
  let total = 0
  const byClient = new Map<string, number>()

  return {
    tryAcquire(clientKey) {
      if (total >= maxPerProcess) {
        return null
      }

      const normalizedKey = clientKey ? clientKey : null
      if (normalizedKey !== null) {
        const current = byClient.get(normalizedKey) ?? 0
        if (current >= maxPerClient) {
          return null
        }
        byClient.set(normalizedKey, current + 1)
      }

      total += 1
      let released = false

      return () => {
        if (released) return
        released = true
        total -= 1
        if (normalizedKey !== null) {
          const remaining = (byClient.get(normalizedKey) ?? 1) - 1
          if (remaining <= 0) {
            byClient.delete(normalizedKey)
          } else {
            byClient.set(normalizedKey, remaining)
          }
        }
      }
    },

    getActiveCount() {
      return total
    },

    getClientActiveCount(clientKey) {
      if (!clientKey) return 0
      return byClient.get(clientKey) ?? 0
    }
  }
}
