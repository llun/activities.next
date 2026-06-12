// This schema is based on https://docs.joinmastodon.org/entities/Rule/
import { z } from 'zod'

export const Rule = z.object({
  id: z.string().describe('An identifier for the rule'),
  text: z.string().describe('The rule to be followed'),
  hint: z.string().describe('Longer-form description of the rule')
})
export type Rule = z.infer<typeof Rule>
