import { vi } from 'vitest'

/**
 * An in-memory BroadcastChannel for tests. Node's real one is process-wide
 * across worker threads, and Vitest runs test files on worker threads, so a
 * test that touches the real channel talks to other test files. Install with
 * `installFakeBroadcastChannel()` (it calls `vi.stubGlobal`) and undo with
 * `vi.unstubAllGlobals()`.
 */
export class FakeBroadcastChannel {
  static readonly channels = new Map<string, Set<FakeBroadcastChannel>>()

  onmessage: ((event: MessageEvent) => void) | null = null
  private closed = false

  constructor(readonly name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  /** Delivers to every other open channel of the same name, never to itself. */
  postMessage(data: unknown) {
    if (this.closed) throw new Error('InvalidStateError: channel is closed')
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) {
        peer.onmessage?.({ data: structuredClone(data) } as MessageEvent)
      }
    }
  }

  close() {
    this.closed = true
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }

  static reset() {
    FakeBroadcastChannel.channels.clear()
  }
}

export const installFakeBroadcastChannel = (): typeof FakeBroadcastChannel => {
  FakeBroadcastChannel.reset()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  return FakeBroadcastChannel
}
