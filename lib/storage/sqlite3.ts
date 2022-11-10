import { knex, Knex } from 'knex'
import { Status } from '../models/status'

export class Sqlite3Storage {
  database: Knex

  constructor(config: Knex.Config) {
    this.database = knex(config)
  }

  createAccount() {}
  getAccountById() {}

  createStatus(status: Status) {
    // https://github.com/mastodon/mastodon/blob/a5394980f22e061ec7e4f6df3f3b571624f5ca7d/app/lib/activitypub/parser/status_parser.rb#L3
    // const status = {
    //   uri: '@status_parser.uri',
    //   url: '@status_parser.url || @status_parser.uri',
    //   account: @account,
    //   text: converted_object_type? ? converted_text : (@status_parser.text || ''),
    //   language: @status_parser.language,
    //   spoiler_text: converted_object_type? ? '' : (@status_parser.spoiler_text || ''),
    //   created_at: @status_parser.created_at,
    //   edited_at: @status_parser.edited_at && @status_parser.edited_at != @status_parser.created_at ? @status_parser.edited_at : nil,
    //   override_timestamps: @options[:override_timestamps],
    //   reply: @status_parser.reply,
    //   sensitive: @account.sensitized? || @status_parser.sensitive || false,
    //   visibility: @status_parser.visibility,
    //   thread: replied_to_status,
    //   conversation: conversation_from_uri(@object['conversation']),
    //   media_attachment_ids: process_attachments.take(4).map(&:id),
    //   poll: process_poll,
    // }
    const { account, ...rest } = status
    console.log(rest)
  }
}
