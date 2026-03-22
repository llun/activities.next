# Contributing to Activities.next

Thank you for your interest in contributing to Activities.next! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)

## Code of Conduct

This project follows the standard open source code of conduct. Be respectful, inclusive, and considerate in all interactions.

## Getting Started

### Prerequisites

- **Node.js 24** or higher
- **Yarn** 4.12.0 (via Corepack)
- **Git**
- A code editor (VS Code recommended)

### Setting Up Development Environment

1. **Fork and clone the repository**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/activities.next.git
   cd activities.next
   ```

2. **Enable Corepack** (for Yarn 4 support):

   ```bash
   corepack enable
   ```

3. **Install dependencies**:

   ```bash
   yarn install
   ```

4. **Set up your environment**:

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your local configuration
   ```

   At minimum, set `ACTIVITIES_HOST`, `ACTIVITIES_SECRET_PHASE`, and a database configuration (e.g., `ACTIVITIES_DATABASE_CLIENT=better-sqlite3`).

5. **Run database migrations**:

   ```bash
   yarn migrate
   ```

6. **Start the development server**:

   ```bash
   yarn dev
   ```

7. **Open your browser** to [http://localhost:3000](http://localhost:3000)

## Development Workflow

### Branch Naming

Use descriptive branch names:

- `feature/description` - For new features
- `fix/description` - For bug fixes
- `docs/description` - For documentation changes
- `refactor/description` - For code refactoring

### Commit Messages

Follow conventional commit format:

- `feat: add new feature`
- `fix: resolve bug in component`
- `docs: update setup guide`
- `style: format code with prettier`
- `refactor: restructure database queries`
- `test: add tests for status model`
- `chore: update dependencies`

Keep commits:

- Small and focused
- With clear, descriptive messages
- Building on each other logically

## Coding Standards

### TypeScript

- **Use strict TypeScript**: Avoid `any` types — use proper types or `unknown`
- **Type everything**: Functions, parameters, and complex objects should have explicit types
- **Use TypeScript features**: Interfaces, type guards, utility types, etc.

### Code Style

The project uses:

- **Prettier** for formatting (runs automatically on commit via Husky)
- **ESLint** for linting
- **2-space indentation**
- **Single quotes**
- **No semicolons**

Run formatting and linting:

```bash
yarn prettier
yarn lint
```

### Import Conventions

- Use **absolute imports** (`@/lib/...`) for anything outside the current directory
- **Relative imports** (`./helper`) are only allowed for files in the same directory
- **Never** use `../` relative imports
- Apply the same rules to `jest.mock(...)` paths

### File Organization

- Place tests next to the code: `feature.ts` and `feature.test.ts`
- Follow existing directory structure

### Naming Conventions

- **Files**: camelCase for utilities, PascalCase for components
- **Variables/Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE for true constants
- **React Components**: PascalCase

### React Components

- Use functional components with hooks
- Prefer named exports for components
- Use TypeScript interfaces for props
- Keep components focused and single-purpose

Example:

```typescript
interface ProfileCardProps {
  actor: Actor
  isFollowing: boolean
  onFollow: () => void
}

export const ProfileCard: FC<ProfileCardProps> = ({
  actor,
  isFollowing,
  onFollow
}) => {
  // Component implementation
}
```

### Logging

- **Never** use `console.log`, `console.warn`, `console.error`, or any `console.*` methods in committed code
- Exception: Migration files in `migrations/` and scripts in `scripts/` may use `console.*`
- For server-side code, use the logger:

```typescript
import { logger } from '@/lib/utils/logger'

logger.info({ message: 'Something happened' })
logger.error({ message: 'Error occurred', error })
```

- **Do not** use logger in React components or client-side code

### API Responses

- Always use `apiResponse` and `apiErrorResponse` from `@/lib/utils/response`
- **Never** use `Response.json()` directly in API routes

```typescript
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'

// Success response (requires req and allowedMethods for CORS headers)
return apiResponse({ req, allowedMethods: ['GET'], data: result })

// Error response
return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
```

## Testing

### Running Tests

```bash
# Run all tests (includes database tests with SQLite in-memory)
yarn test
```

All tests run in parallel using isolated SQLite in-memory databases for fast execution.

### Writing Tests

- **Co-locate tests** with the code being tested
- **Use descriptive test names** that explain what is being tested
- **Follow AAA pattern**: Arrange, Act, Assert
- **Test behavior**, not implementation details

Example:

```typescript
describe('createNote', () => {
  it('creates a new status and adds it to timeline', async () => {
    // Arrange
    const actor = await createTestActor()
    const noteData = { text: 'Test note', ... }

    // Act
    const status = await createNote(noteData)

    // Assert
    expect(status).toBeDefined()
    expect(status.text).toBe('Test note')
  })
})
```

### Test Coverage

- Aim for high coverage of business logic
- Don't skip edge cases
- Test error conditions
- Mock external dependencies appropriately

## Pull Request Process

### Before Submitting

Run all checks in order:

```bash
yarn prettier                    # Format code
yarn lint                        # Lint — must pass with no errors
yarn build                       # Build — must succeed
yarn test                        # Tests — must pass
```

Also:

- Update documentation if needed
- Test manually if UI changes are involved
- Rebase on main to ensure clean history:

  ```bash
  git fetch origin
  git rebase origin/main
  ```

### PR Guidelines

- **Title**: Clear and descriptive (follows conventional commit format)
- **Description**: Explain what and why, not just how
  - What problem does this solve?
  - What approach did you take?
  - Any breaking changes?
  - Screenshots for UI changes
- **Link issues**: Reference related issues using `Fixes #123` or `Relates to #456`
- **Keep PRs focused**: One feature/fix per PR

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated (if applicable)
- [ ] No `console.log` statements (use logger for server-side code)
- [ ] TypeScript types are proper (no `any`)
- [ ] Commit messages follow convention
- [ ] `yarn lint` and `yarn build` pass

## Project Structure

```
activities.next/
├── app/                       # Next.js App Router
│   ├── (timeline)/            # Timeline routes (with sidebar)
│   ├── (nosidebar)/           # Auth routes (no sidebar)
│   ├── api/                   # API routes
│   │   ├── auth/              #   Authentication (better-auth)
│   │   ├── v1/               #   Mastodon-compatible API v1
│   │   ├── v2/               #   Mastodon-compatible API v2
│   │   ├── users/            #   ActivityPub actor endpoints
│   │   ├── oauth/            #   OAuth 2.0 provider
│   │   └── well-known/       #   Federation discovery
│   └── layout.tsx             # Root layout
├── lib/                       # Core application logic
│   ├── actions/               # Server actions
│   ├── activities/            # ActivityPub protocol logic
│   ├── components/            # Shared React components
│   ├── config/                # Configuration loaders
│   ├── database/              # Database abstraction (Knex)
│   ├── jobs/                  # Background job handlers
│   ├── services/              # Business logic services
│   ├── types/                 # TypeScript type definitions
│   └── utils/                 # Utility functions
├── migrations/                # Database migrations (Knex)
├── docs/                      # Documentation
├── public/                    # Static assets
└── scripts/                   # Development/admin scripts
```

### Important Files

- `package.json` — Dependencies and scripts
- `tsconfig.json` — TypeScript configuration
- `eslint.config.mjs` — ESLint rules
- `.prettierrc.yml` — Code formatting rules
- `jest.config.mjs` — Test configuration
- `next.config.ts` — Next.js configuration
- `knexfile.js` — Database migration configuration
- `Dockerfile` — Docker container build

## Common Tasks

### Adding a New API Endpoint

1. Create route in `app/api/v1/[endpoint]/route.ts`
2. Define request/response types using Zod
3. Add authentication guard if needed (use guards from `lib/services/guards/`)
4. Use `apiResponse`/`apiErrorResponse` for responses
5. Add tests

### Adding a New Background Job

1. Create job handler in `lib/jobs/`
2. Add job name constant in `lib/jobs/names.ts`
3. Register the job in `lib/jobs/index.ts`
4. Add tests

### Creating a Database Migration

```bash
yarn migrate:make descriptive_migration_name
```

Edit the generated file in `migrations/`, then run:

```bash
yarn migrate
```

> **Important:** All migrations must work with both SQLite and PostgreSQL. Use Knex query builder and avoid database-specific SQL.

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [better-auth Documentation](https://www.better-auth.com/)
- [Knex.js Documentation](https://knexjs.org/)

## Getting Help

- Check existing [issues](https://github.com/llun/activities.next/issues)
- Review [documentation](docs/)
- Ask questions in discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
