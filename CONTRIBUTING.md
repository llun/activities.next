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

- Node.js 18 or higher
- Yarn 4.12.0 (via Corepack)
- Git
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

5. **Run database migrations** (if using SQL):

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

- **Use strict TypeScript**: Avoid `any` types - use proper types or `unknown`
- **Type everything**: Functions, parameters, and complex objects should have explicit types
- **Use TypeScript features**: Enums, interfaces, type guards, etc.

### Code Style

The project uses:

- **Prettier** for formatting (runs automatically on commit)
- **ESLint** for linting
- **2-space indentation**
- **Single quotes**
- **No semicolons**

Run formatting and linting:

```bash
yarn lint
yarn prettier
```

### File Organization

- Place tests next to the code: `feature.ts` and `feature.test.ts`
- Use index files for cleaner imports
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

### Error Handling

- Use the logger utility (`@/lib/utils/logger`) instead of `console.log`/`console.error`
- Provide meaningful error messages
- Handle edge cases gracefully

```typescript
import { logger } from '@/lib/utils/logger'

try {
  // code
} catch (error) {
  logger.error('Failed to process request', { error, context })
}
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

1. **Ensure tests pass**:

   ```bash
   yarn test
   ```

2. **Run linting**:

   ```bash
   yarn lint
   ```

3. **Update documentation** if needed

4. **Test manually** if UI changes are involved

5. **Rebase on main** to ensure clean history:
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
- **Request review**: Tag relevant maintainers if needed

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Tests added/updated and passing
- [ ] Documentation updated (if applicable)
- [ ] No console.log statements (use logger)
- [ ] TypeScript types are proper (no `any`)
- [ ] Commit messages follow convention
- [ ] PR description is clear and complete

## Project Structure

### Key Directories

```
activities.next/
├── app/                    # Next.js App Router
│   ├── (timeline)/        # Timeline routes (with sidebar)
│   ├── (nosidebar)/       # Auth routes (no sidebar)
│   ├── api/               # API routes
│   └── layout.tsx         # Root layout
├── lib/                   # Core application logic
│   ├── actions/           # Server actions
│   ├── activities/        # ActivityPub logic
│   ├── components/        # Shared React components
│   ├── database/          # Database abstraction
│   ├── jobs/              # Background job handlers
│   ├── models/            # Data models
│   ├── services/          # Business logic services
│   └── utils/             # Utility functions
├── migrations/            # Database migrations
├── docs/                  # Documentation
├── public/                # Static assets
└── scripts/               # Development/admin scripts
```

### Important Files

- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `eslint.config.mjs` - ESLint rules
- `.prettierrc.yml` - Code formatting rules
- `jest.config.js` - Test configuration
- `next.config.ts` - Next.js configuration
- `knexfile.js` - Database migration configuration

## Common Tasks

### Adding a New Database Model

1. Create model in `lib/models/`
2. Add database interface in `lib/database/types/`
3. Implement in `lib/database/sql/` or `lib/database/dynamodb/`
4. Create migration: `yarn migrate:make model_name`
5. Add tests

### Adding a New API Endpoint

1. Create route in `app/api/v1/[endpoint]/route.ts`
2. Define request/response types using Zod
3. Add authentication guard if needed
4. Add tests
5. Update API documentation

### Adding a New Job

1. Create job handler in `lib/jobs/`
2. Add job name constant in `lib/jobs/names.ts`
3. Add job to queue service
4. Add tests

### Creating a Database Migration

```bash
yarn migrate:make descriptive_migration_name
```

Edit the generated file in `migrations/`, then run:

```bash
yarn migrate
```

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [ActivityPub Specification](https://www.w3.org/TR/activitypub/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Documentation](https://jestjs.io/docs/getting-started)

## Getting Help

- Check existing [issues](https://github.com/llun/activities.next/issues)
- Review [documentation](docs/)
- Ask questions in discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
