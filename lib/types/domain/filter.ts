import { z } from 'zod'

export const FilterContext = z.enum([
  'home',
  'notifications',
  'public',
  'thread',
  'account'
])
export type FilterContext = z.infer<typeof FilterContext>

export const FilterAction = z.enum(['warn', 'hide'])
export type FilterAction = z.infer<typeof FilterAction>

export const Filter = z.object({
  id: z.string(),
  actorId: z.string(),
  title: z.string(),
  context: FilterContext.array(),
  filterAction: FilterAction,
  expiresAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type Filter = z.infer<typeof Filter>

export const FilterKeyword = z.object({
  id: z.string(),
  filterId: z.string(),
  keyword: z.string(),
  wholeWord: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type FilterKeyword = z.infer<typeof FilterKeyword>

export const FilterStatus = z.object({
  id: z.string(),
  filterId: z.string(),
  statusId: z.string(),
  createdAt: z.number()
})
export type FilterStatus = z.infer<typeof FilterStatus>
