import nextJest from 'next/jest.js'

// Fix EventEmitter memory leak warning in test setup
// Set a reasonable higher limit instead of unlimited (0)
// This is safe for test environments with parallel execution
process.setMaxListeners(50)

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.ts and .env files in your test environment
  dir: './'
})

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const customJestConfig = {
  // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],
  // if using TypeScript with a baseUrl set to the root directory then you need the below for alias' to work
  moduleDirectories: ['node_modules', '<rootDir>/'],
  testEnvironment: 'node',
  automock: false,
  resetMocks: false,
  setupFilesAfterEnv: ['jest-extended/all'],
  setupFiles: ['<rootDir>/jest.setup.mjs'],
  transform: {
    '\\.(js|jsx|ts|tsx)$': ['@swc/jest']
  },
  transformIgnorePatterns: ['node_modules/(?!(marked|uuid)/)'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@/app/(.*)$': '<rootDir>/app/$1',
    '^@/lib/(.*)$': '<rootDir>/lib/$1',
    '^@/pages/(.*)$': '<rootDir>/pages/$1',
    '^@/(.*)$': '<rootDir>/$1',
    '^marked$': '<rootDir>/node_modules/marked/lib/marked.umd.js'
  },
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'app/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/*.test.{ts,tsx}',
    '!**/coverage/**',
    // Exclude React components (require browser testing)
    '!lib/components/**',
    '!app/**/page.tsx',
    '!app/**/layout.tsx',
    '!app/**/*Card*.tsx',
    '!app/**/*Button*.tsx',
    '!app/**/*Form*.tsx',
    '!app/**/*Modal*.tsx',
    '!app/**/*Timeline*.tsx',
    '!app/**/*Gallery*.tsx',
    '!app/**/*.tsx',
    // Exclude UI components
    '!lib/components/ui/**',
    // Exclude browser-only client code
    '!lib/client.ts'
  ],
  verbose: true
}

export default createJestConfig(customJestConfig)
