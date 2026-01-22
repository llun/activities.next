# Activity.next

Activity.next is an ActivityPub server built with Next.js and TypeScript. It enables you to host your own instance in the Fediverse - the decentralized social media network.

See our [feature roadmap](docs/features.md) for current and planned features.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- Yarn package manager (v4.12.0 via Corepack)
- A domain name (for federation)

### Quick Start

1. Clone the repository:

```bash
git clone https://github.com/llun/activities.next.git
cd activities.next
```

2. Enable Corepack (for Yarn 4 support):

```bash
corepack enable
```

3. Install dependencies:

```bash
yarn install
```

4. Configure your environment (see the [Setup Guide](docs/setup.md)):

```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

5. Run database migrations (if using SQL):

```bash
yarn migrate
```

6. Start the development server:

```bash
yarn dev
```

For detailed setup instructions, see the [Setup Guide](docs/setup.md).

## Deployment Options

### Deploy on Vercel

To deploy on Vercel:

1. Fork this repository
2. Connect it to your Vercel account
3. Add the required environment variables (see [Setup Guide](docs/setup.md))

### Deploy with Docker

To run using Docker:

```bash
docker run -p 3000:3000 \
  -e ACTIVITIES_HOST=your.domain.tld \
  -e ACTIVITIES_SECRET_PHASE=random-secret \
  -e NEXTAUTH_URL=https://your.domain.tld \
  -e NEXTAUTH_SECRET=session-secret \
  -v /path/to/data:/opt/activities.next \
  ghcr.io/llun/activities.next:latest
```

For more Docker options, see the database-specific setup guides.

## Documentation

- [Setup Guide](docs/setup.md)
- [SQLite Setup](docs/sqlite-setup.md)
- [PostgreSQL Setup](docs/postgresql-setup.md)
- [Maintenance Scripts](docs/maintenance.md)
- [Feature Roadmap](docs/features.md)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.
