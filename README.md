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
  },
  "auth": {
    "github": {
      "id": "GITHUB_APP_CLIENT_ID",
      "secret": "GITHUB_APP_SECRET"
    }
  }
}
```
