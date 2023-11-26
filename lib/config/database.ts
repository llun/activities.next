import { Settings as FirestoreSetting } from '@google-cloud/firestore'
import { Knex } from 'knex'
import { z } from 'zod'

export const KnexBaseDatabase = z
  .object({
    type: z.union([z.literal('sqlite3'), z.literal('sql'), z.literal('knex')])
  })
  .passthrough()
export type KnexBaseDatabase = Knex.Config & z.infer<typeof KnexBaseDatabase>

export const FirebaseDatabase = z
  .object({
    type: z.union([z.literal('firebase'), z.literal('firestore')])
  })
  .passthrough()
export type FirebaseDatabase = FirestoreSetting &
  z.infer<typeof FirebaseDatabase>
