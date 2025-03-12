# Activity.next: A Modern ActivityPub Server

Activity.next is a modern, flexible ActivityPub server built with Next.js and TypeScript. It enables you to participate in the Fediverse - the decentralized social media network that includes platforms like Mastodon, Pleroma, and many others.

## Features

- **ActivityPub Protocol**: Full implementation of ActivityPub for federated social networking
- **Modern Tech Stack**: Built with Next.js, React, and TypeScript
- **Flexible Storage**: Supports SQLite, PostgreSQL, and Firebase/Firestore
- **Media Handling**: Upload and serve images with various storage backends (S3, local, etc.)
- **Authentication Options**: Local accounts, OAuth, GitHub integration
- **Responsive Interface**: Mobile-friendly web interface
- **Developer Friendly**: Well-structured codebase, comprehensive documentation
- **API Compatible**: Aiming for Mastodon API compatibility for client support

See our complete [feature roadmap](docs/features.md) for current and planned features.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- Yarn package manager
- A domain name (for federation)

### Quick Start

1. Clone the repository:
```bash
git clone https://github.com/llun/activities.next.git
cd activities.next
```

2. Install dependencies:
```bash
yarn install
```

3. Configure your environment (see the [Setup Guide](docs/setup.md))

4. Run database migrations (if using SQL):
```bash
yarn migrate
```

5. Start the development server:
```bash
yarn dev
```

For detailed setup instructions, see the [Setup Guide](docs/setup.md).

## Deployment Options

### Deploy on Vercel

To deploy on Vercel:

1. Fork this repository
2. Connect it to your Vercel account
3. Add the following environment variables:

```
ACTIVITIES_HOST=your-domain.tld
ACTIVITIES_DATABASE='{"type":"sql","client":"better-sqlite3","useNullAsDefault":true,"connection":{"filename":"./dev.sqlite3"}}'
ACTIVITIES_SECRET_PHASE='random-hash-for-cookie'
ACTIVITIES_ALLOW_EMAILS='["your-email@example.com"]'
ACTIVITIES_ALLOW_MEDIA_DOMAINS='[]'
ACTIVITIES_AUTH='{"github":{"id":"GITHUB_APP_CLIENT_ID","secret":"GITHUB_APP_SECRET"}}'
ACTIVITIES_EMAIL='{"type":"smtp","host":"email-smtp.example.com","port":465,"secure":true,"debug":true,"serviceFromAddress":"Service <email@domain.tld>","auth":{"user":"username","pass":"password"}}'
```

For production, consider using PostgreSQL instead of SQLite by changing the database client configuration.

### Deploy with Docker

When running the Docker image, provide these environment variables:

```
NEXTAUTH_URL=https://your.domain.tld
NEXTAUTH_SECRET=session-secret
ACTIVITIES_HOST=your.domain.tld
ACTIVITIES_SECRET_PHASE='random-hash-for-cookie'
ACTIVITIES_DATABASE_TYPE=sql
ACTIVITIES_DATABASE_CLIENT=sqlite3
ACTIVITIES_DATABASE_SQLITE_FILENAME=data.sqlite
```

If you don't provide a database config, the database will persist in the container at `/opt/activities.next/data.sqlite`. You can mount this file when starting the container.

## Documentation

- [Setup Guide](docs/setup.md)
- [SQLite Setup](docs/sqlite-setup.md)
- [PostgreSQL Setup](docs/postgresql-setup.md)
- [Firebase Setup](docs/firebase-setup.md)
- [Feature Roadmap](docs/features.md)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.