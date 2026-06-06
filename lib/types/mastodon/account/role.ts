// This schema is based on https://docs.joinmastodon.org/entities/Role/
import { z } from 'zod'

export const Role = z.object({
  id: z.string().describe('The ID of the Role in the database'),
  name: z.string().describe('The name of the role'),
  color: z
    .string()
    .describe(
      'The hex code assigned to this role. If no hex code is assigned, the string will be empty'
    ),
  permissions: z
    .string()
    .describe('A bitmask that represents the sum of all permissions granted'),
  highlighted: z
    .boolean()
    .describe(
      'Whether the role is publicly visible as a badge on user profiles'
    )
})
export type Role = z.infer<typeof Role>
