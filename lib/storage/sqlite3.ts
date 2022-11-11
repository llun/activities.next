import { knex, Knex } from 'knex'
import { Status } from '../models/status'

export class Sqlite3Storage {
  database: Knex

  constructor(config: Knex.Config) {
    this.database = knex(config)
  }

  createAccount() {}
  getAccountById() {}

  async createStatus(status: Status) {
    const { account, mediaAttachmentIds, ...rest } = status
    await this.database.insert(rest).into('status')
    console.log(rest)
  }

  async getStatuses() {
    return this.database<Status>('status')
      .select('*')
      .orderBy('createdAt', 'desc')
  }
}
