// This schema is based on https://docs.joinmastodon.org/entities/Admin_Account/
import { z } from 'zod'

import { Account } from '@/lib/types/mastodon/account'
import { Role } from '@/lib/types/mastodon/account/role'

// Admin::Ip — an IP address and the last time it was used.
export const AdminIp = z.object({
  ip: z.string(),
  used_at: z.string()
})
export type AdminIp = z.infer<typeof AdminIp>

export const AdminAccount = z.object({
  // The Mastodon id space here is `urlToId(actor.id)` — the same id every other
  // account-shaped endpoint emits — never the internal accounts UUID.
  id: z.string(),
  username: z.string(),
  // null for actors on the instance's own configured host; the qualified domain
  // for remote actors (and local actors served on a secondary domain).
  domain: z.string().nullable(),
  created_at: z.string(),
  // '' for remote actors (no login/email).
  email: z.string(),
  // Latest session IP, null when unknown or remote.
  ip: z.string().nullable(),
  ips: z.array(AdminIp),
  // Not tracked by this server; always null (documented divergence).
  locale: z.string().nullable(),
  invite_request: z.string().nullable(),
  // The default Role overlay (admin accounts get the admin role); null remote.
  role: Role.nullable(),
  confirmed: z.boolean(),
  approved: z.boolean(),
  disabled: z.boolean(),
  silenced: z.boolean(),
  suspended: z.boolean(),
  sensitized: z.boolean(),
  // The public Account entity for this actor.
  account: Account
})
export type AdminAccount = z.infer<typeof AdminAccount>
