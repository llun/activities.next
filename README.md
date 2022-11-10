# Personal Mastodon Server

Add `config.json` with database config

```
{
  "host": "chat.llun.in.th",
  "database": {
    "type": "knex",
    "client": "better-sqlite3",
    "useNullAsDefault": true,
    "connection": {
      "filename": "./dev.sqlite3"
    }
  }
}
```
