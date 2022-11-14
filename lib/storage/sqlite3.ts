import { knex, Knex } from 'knex'
import crypto from 'crypto'
import { Account } from '../models/account'
import { Status } from '../models/status'
import { Actor } from '../models/actor'

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
    const response = await this.database('actors')
      .where('handle', handle)
      .count('id as count')
      .first()
    return Boolean(response?.count && response?.count > 0)
  }

  async createAccount(params: {
    email: string
    handle: string
    privateKey: string
    publicKey: string
  }) {
    const { email, handle, privateKey, publicKey } = params
    const accountId = crypto.randomUUID()
    const actorId = crypto.randomUUID()
    const currentTime = Date.now()
    await this.database.transaction(async (trx) => {
      await trx('accounts').insert({
        id: accountId,
        email,
        createdAt: currentTime
      })
      await trx('actors').insert({
        id: actorId,
        handle,
        publicKey,
        privateKey,
        createdAt: currentTime
      })
    })

    return accountId
  }

  async getActorFromHandle(handle: string) {
    return (await this.database('actors')
      .where('handle', handle)
      .first()) as Actor
  }

  async createStatus(status: Status) {
    const { account, mediaAttachmentIds, ...rest } = status
    await this.database.insert(rest).into('statuses')
  }

  async getStatuses() {
    return this.database<Status>('statuses')
      .select('*')
      .orderBy('createdAt', 'desc')
  }
}
