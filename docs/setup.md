# Activity.next Setup Guide

This guide provides an overview of how to set up Activity.next for development or production.

## Database Setup

Activity.next supports multiple database backends. Choose the one that best suits your needs:

- [SQLite Setup Guide](sqlite-setup.md) - Best for development or small instances
- [PostgreSQL Setup Guide](postgresql-setup.md) - Recommended for production deployments
- [Firebase/Firestore Setup Guide](firebase-setup.md) - Alternative cloud-based option

## General Configuration

Regardless of which database you choose, you'll need the following configuration:

### Domain Name Configuration

Set your instance's domain name:

```json
{
  "host": "your-domain.tld"
}
```

### Access Control

Restrict who can sign up to your instance by specifying allowed emails:

```json
{
  "allowEmails": ["your_email@example.com"]
}
```

### Authentication Secret

Set a secret phrase for cookies and JWT sessions:

```json
{
  "secretPhase": "your-random-secret-for-sessions"
}
```

### Authentication Providers

The service includes local username/password authentication by default.

For GitHub OAuth authentication:

1. Create a GitHub OAuth app in your GitHub settings
   ![GitHub OAuth app settings](images/github-settings-oauth-apps.png)

2. Set the callback URL to `https://your-domain.tld/api/auth/callback/github`

3. Add the credentials to your config:

```json
{
  "auth": {
    "github": {
      "id": "github-app-client-id",
      "secret": "github-app-secret"
    }
  }
}
```

## Starting the Application

### Development Environment

To run the service locally:

```bash
yarn dev
```

To communicate with other servers in the fediverse while running locally, you'll need a tunnel service like [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) or [ngrok](https://ngrok.com/).

### First-Time Setup

After starting the application:

1. Sign up at `https://your-domain.tld/auth/signup` (if your email is in the allowlist)
2. Log in with your new account
3. You can now interact with other ActivityPub servers in the fediverse

## Deployment Options

Activity.next can be deployed in various ways:

- [Vercel Deployment Guide](#host-it-on-vercel)
- [Docker Deployment Guide](#host-with-docker)

Check the main README.md for specific deployment instructions.