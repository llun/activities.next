const config = {
  host: 'chat.llun.in.th',
  database: {
    type: 'knex',
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: './dev.sqlite3'
    }
  }
}

export default config
