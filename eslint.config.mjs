import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import typescriptPlugin from '@typescript-eslint/eslint-plugin'
import typescriptParser from '@typescript-eslint/parser'
import unusedImportsPlugin from 'eslint-plugin-unused-imports'
import globals from 'globals'

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      '.yarn/**',
      'coverage/**',
      'node_modules/**',
      'migrations/**',
      'plans/**',
      'scripts/**',
      '*.config.mjs',
      '*.config.js',
      '*.config.ts',
      'wallaby.js',
      'test-config.js'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
    plugins: {
      '@next/next': nextPlugin,
      '@typescript-eslint': typescriptPlugin,
      'unused-imports': unusedImportsPlugin
    },
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        React: 'readonly',
        JSX: 'readonly',
        NodeJS: 'readonly',
        BodyInit: 'readonly',
        FormDataEntryValue: 'readonly'
      }
    },
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      '@next/next/no-img-element': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-unsafe-optional-chaining': 'warn'
    }
  },
  // AGENTS.md conventions enforced as lint rules (see AGENTS.md → Build, Test,
  // and Development Commands). Env-read discipline (no ACTIVITIES_*/OTEL_*
  // reads outside lib/config/) is enforced by lib/config/envAccess.test.ts.
  {
    files: [
      'app/**/*.{js,jsx,ts,tsx}',
      'lib/**/*.{js,jsx,ts,tsx}',
      'proxy.ts',
      'instrumentation.ts'
    ],
    rules: {
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['..', '../**'],
              message:
                'Use absolute imports (@/lib/..., @/app/...) for anything outside the current directory (AGENTS.md → Coding Style & Naming Conventions).'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['app/api/**/route.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Response'][callee.property.name='json']",
          message:
            'Use apiResponse/apiErrorResponse from @/lib/utils/response in API routes, not Response.json() (AGENTS.md → API Response Guidelines).'
        },
        {
          selector:
            "CallExpression[callee.object.name='NextResponse'][callee.property.name='json']",
          message:
            'Use apiResponse/apiErrorResponse from @/lib/utils/response in API routes, not NextResponse.json() (AGENTS.md → API Response Guidelines).'
        },
        {
          selector:
            "CallExpression[callee.property.name='parse'][callee.object.name!='JSON'][callee.object.name!='Date']",
          message:
            'Use safeParse, never .parse(), for Zod validation in API routes — .parse() throws and surfaces as a 500 (AGENTS.md → Zod Validation in API Routes). If this is not a Zod schema, add an eslint-disable-next-line comment saying so.'
        }
      ]
    }
  },
  // Direct fetch() is banned in React component files — client→server calls
  // go through named exported functions in lib/client.ts (AGENTS.md →
  // Client-Side API Calls). The ignores list below is the FROZEN set of
  // legacy offenders from before this rule existed: migrate them to
  // lib/client.ts when touched and remove them from the list. NEVER add a
  // new file here.
  {
    files: ['app/**/*.tsx', 'lib/components/**/*.tsx'],
    ignores: [
      '**/*.test.tsx',
      'app/(timeline)/fitness/strava/StravaSettingsForm.tsx',
      'app/(timeline)/account/ChangeEmailForm.tsx',
      'app/(timeline)/account/ChangeNameForm.tsx',
      'app/(timeline)/account/security/ChangePasswordForm.tsx',
      'app/(nosidebar)/oauth/authorize/AuthorizeCard.tsx',
      'app/(nosidebar)/auth/forgot-password/RequestPasswordResetForm.tsx',
      'app/(nosidebar)/auth/reset-password/ResetPasswordForm.tsx',
      'lib/components/settings/DeleteActorDialog.tsx',
      'lib/components/settings/MediaManagement.tsx',
      'lib/components/settings/ActorsSection.tsx',
      'lib/components/actor-switcher/ActorSwitcher.tsx',
      'lib/components/actor-switcher/AddActorDialog.tsx'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Do not call fetch() directly in components — add a named function to lib/client.ts and import it (AGENTS.md → Client-Side API Calls).'
        }
      ]
    }
  },
  {
    files: [
      '**/*.test.js',
      '**/*.test.jsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/__mocks__/**',
      '**/stub/**'
    ],
    languageOptions: {
      globals: {
        vi: true,
        jest: true,
        describe: true,
        it: true,
        expect: true,
        beforeAll: true,
        afterAll: true,
        beforeEach: true,
        afterEach: true,
        test: true,
        fetchMock: true,
        fail: true
      }
    }
  }
]

export default eslintConfig
