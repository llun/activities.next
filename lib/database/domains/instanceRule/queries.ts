import { randomUUID } from 'node:crypto'

import type {
  CreateInstanceRuleParams,
  DeleteInstanceRuleParams,
  InstanceRuleData,
  UpdateInstanceRuleParams
} from '@/lib/database/domains/instanceRule/types'
import type { Db } from '@/lib/database/kysely'

const COLUMNS = [
  'id',
  'position',
  'text',
  'hint',
  'createdAt',
  'updatedAt'
] as const

export const createInstanceRule = async (
  db: Db,
  { text, hint, position = 0 }: CreateInstanceRuleParams
): Promise<InstanceRuleData> => {
  const currentTime = new Date()
  const id = randomUUID()
  await db
    .insertInto('instance_rules')
    .values({
      id,
      position,
      text,
      hint,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
  return {
    id,
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

export const getInstanceRules = async (db: Db): Promise<InstanceRuleData[]> => {
  const rows = await db
    .selectFrom('instance_rules')
    .select(COLUMNS)
    .orderBy('position', 'asc')
    .orderBy('createdAt', 'asc')
    .execute()
  return rows
}

export const instanceRuleQueries = {
  createInstanceRule,
  updateInstanceRule,
  deleteInstanceRule,
  getInstanceRules
}
