import { knex, Knex } from 'knex'
import crypto from 'crypto'
import { Account } from '../models/account'
import { Status } from '../models/status'

export class Sqlite3Storage {
  database: Knex

  constructor(config: Knex.Config) {
    this.database = knex(config)
  }

  async isAccountExists(email?: string | null) {
    if (!email) return false
    const response = await this.database('accounts')
      .where('email', email)
      .count('id as count')
      .first()
    return Boolean(response?.count && response?.count > 0)
  }

  async isHandleExists(handle: string) {
    const response = await this.database('accounts')
      .where('handle', handle)
      .count('id as count')
      .first()
    return Boolean(response?.count && response?.count > 0)
  }

  async createAccount(account: Account) {
    const accountId = crypto.randomUUID()
    await this.database('accounts').insert({ id: accountId, ...account })
    return accountId
  }

  async createStatus(status: Status) {
    const { account, mediaAttachmentIds, ...rest } = status
    await this.database.insert(rest).into('statuses')
    console.log(rest)
  }

  async getStatuses() {
    return this.database<Status>('statuses')
      .select('*')
      .orderBy('createdAt', 'desc')
  }
}
