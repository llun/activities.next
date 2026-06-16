import { z } from 'zod'

// A relay subscription state machine:
// - idle: created but not subscribed (or after an Undo).
// - pending: we sent a Follow and are waiting for the relay's Accept.
// - accepted: the relay accepted; we forward public posts to it and trust the
//   activities it forwards to us.
// - rejected: the relay rejected our Follow.
export const RelayState = z.enum(['idle', 'pending', 'accepted', 'rejected'])
export type RelayState = z.infer<typeof RelayState>

export const Relay = z.object({
  id: z.string(),
  // The relay inbox URL the admin subscribes to. We POST our Follow here and
  // forward local public posts to it.
  inboxUrl: z.string(),
  // The relay's actor id, learned from the relay's Accept. Matched against the
  // HTTP signer of inbound relay-forwarded activities.
  actorId: z.string().nullable(),
  state: RelayState,
  // The id of the Follow activity we sent, used to match the relay's Accept.
  followActivityId: z.string().nullable(),
  // Last delivery/handshake error, surfaced in the admin UI.
  lastError: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export type Relay = z.infer<typeof Relay>
