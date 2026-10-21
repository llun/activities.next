import { randomUUID } from 'node:crypto'

import type {
  CreateInstanceRuleParams,
  DeleteInstanceRuleParams,
  GetInstanceRuleParams,
  GetInstanceRulesParams,
  GetOwnInstanceRulesParams,
  InstanceRuleData,
  UpdateInstanceRuleParams
} from '@/lib/database/domains/instanceRule/types'
import type { Db } from '@/lib/database/kysely'

const COLUMNS = [
  'id',
  'domain',
  'position',
  'text',
  'hint',
  'createdAt',
  'updatedAt'
] as const

export const createInstanceRule = async (
  db: Db,
  { domain = null, text, hint, position = 0 }: CreateInstanceRuleParams
): Promise<InstanceRuleData> => {
  const currentTime = new Date()
  const id = randomUUID()
  await db
    .insertInto('instance_rules')
    .values({
      id,
      domain,
      position,
      text,
      hint,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
  return {
    id,
    domain,
    position,
    text,
    hint,
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }
}

export const updateInstanceRule = async (
  db: Db,
  { id, text, hint, position }: UpdateInstanceRuleParams
): Promise<InstanceRuleData | null> => {
  // Update first and use the affected-row count to detect a missing rule;
  // this drops the extra existence SELECT.
  const { numUpdatedRows } = await db
    .updateTable('instance_rules')
    .set({
      ...(text !== undefined ? { text } : null),
      ...(hint !== undefined ? { hint } : null),
      ...(position !== undefined ? { position } : null),
      updatedAt: new Date()
    })
    .where('id', '=', id)
    .executeTakeFirst()
  if (Number(numUpdatedRows) === 0) return null

  const row = await db
    .selectFrom('instance_rules')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

export const deleteInstanceRule = async (
  db: Db,
  { id }: DeleteInstanceRuleParams
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('instance_rules')
    .where('id', '=', id)
    .executeTakeFirst()
  return Number(numDeletedRows) > 0
}

export const getInstanceRules = async (
  db: Db,
  { domain = null }: GetInstanceRulesParams = {}
): Promise<InstanceRuleData[]> => {
  const rows = await db
    .selectFrom('instance_rules')
    .select(COLUMNS)
    .where((eb) =>
      domain === null
        ? eb('domain', 'is', null)
        : eb.or([eb('domain', 'is', null), eb('domain', '=', domain)])
    )
    // Server rules first, then the domain's own.
    .orderBy((eb) => eb.case().when('domain', 'is', null).then(0).else(1).end())
    .orderBy('position', 'asc')
    .orderBy('createdAt', 'asc')
    .execute()
  return rows
}

export const getOwnInstanceRules = async (
  db: Db,
  { domain }: GetOwnInstanceRulesParams
): Promise<InstanceRuleData[]> =>
  db
    .selectFrom('instance_rules')
    .select(COLUMNS)
    .where((eb) =>
      domain === null ? eb('domain', 'is', null) : eb('domain', '=', domain)
    )
    .orderBy('position', 'asc')
    .orderBy('createdAt', 'asc')
    .execute()

export const getAllInstanceRules = async (
  db: Db
): Promise<InstanceRuleData[]> =>
  db
    .selectFrom('instance_rules')
    .select(COLUMNS)
    .orderBy((eb) => eb.case().when('domain', 'is', null).then(0).else(1).end())
    .orderBy('domain', 'asc')
    .orderBy('position', 'asc')
    .orderBy('createdAt', 'asc')
    .execute()

export const getInstanceRule = async (
  db: Db,
  { id }: GetInstanceRuleParams
): Promise<InstanceRuleData | null> => {
  const row = await db
    .selectFrom('instance_rules')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

export const instanceRuleQueries = {
  createInstanceRule,
  updateInstanceRule,
  deleteInstanceRule,
  getInstanceRules,
  getOwnInstanceRules,
  getAllInstanceRules,
  getInstanceRule
}
