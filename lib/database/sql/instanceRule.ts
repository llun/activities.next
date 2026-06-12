import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateInstanceRuleParams,
  DeleteInstanceRuleParams,
  InstanceRuleData,
  InstanceRuleDatabase,
  UpdateInstanceRuleParams
} from '@/lib/types/database/operations'

type SQLInstanceRule = {
  id: string
  position: number
  text: string
  hint: string
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

const toInstanceRule = (row: SQLInstanceRule): InstanceRuleData => ({
  id: row.id,
  position: Number(row.position),
  text: row.text,
  hint: row.hint,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const InstanceRuleSQLDatabaseMixin = (
  database: Knex
): InstanceRuleDatabase => ({
  async createInstanceRule({
    text,
    hint,
    position = 0
  }: CreateInstanceRuleParams) {
    const currentTime = new Date()
    const id = randomUUID()
    await database('instance_rules').insert({
      id,
      position,
      text,
      hint,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return {
      id,
      position,
      text,
      hint,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  },

  async updateInstanceRule({
    id,
    text,
    hint,
    position
  }: UpdateInstanceRuleParams) {
    const existing = await database<SQLInstanceRule>('instance_rules')
      .where({ id })
      .first()
    if (!existing) return null

    const updatedAt = new Date()
    await database('instance_rules')
      .where({ id })
      .update({
        ...(text !== undefined ? { text } : null),
        ...(hint !== undefined ? { hint } : null),
        ...(position !== undefined ? { position } : null),
        updatedAt
      })

    const row = await database<SQLInstanceRule>('instance_rules')
      .where({ id })
      .first()
    return row ? toInstanceRule(row) : null
  },

  async deleteInstanceRule({ id }: DeleteInstanceRuleParams) {
    const deleted = await database('instance_rules').where({ id }).delete()
    return deleted > 0
  },

  async getInstanceRules() {
    const rows = await database<SQLInstanceRule>('instance_rules')
      .orderBy('position', 'asc')
      .orderBy('createdAt', 'asc')
    return rows.map(toInstanceRule)
  }
})
