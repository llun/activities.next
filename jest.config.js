/* eslint-disable @typescript-eslint/no-var-requires */
const nextJest = require('next/jest')

// Fix EventEmitter memory leak warning in test setup
// Set a reasonable higher limit instead of unlimited (0)
// This is safe for test environments with parallel execution
process.setMaxListeners(50)

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './'
})

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const customJestConfig = {
  // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // if using TypeScript with a baseUrl set to the root directory then you need the below for alias' to work
  moduleDirectories: ['node_modules', '<rootDir>/'],
  testEnvironment: 'node',
  automock: false,
  resetMocks: false,
  setupFilesAfterEnv: ['jest-extended/all'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '\\.(js|jsx|ts|tsx)$': ['@swc/jest']
  },
  transformIgnorePatterns: [
    'node_modules/(?!(marked)/)'
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^marked$': '<rootDir>/node_modules/marked/lib/marked.umd.js'
  },
  verbose: true
}

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = createJestConfig(customJestConfig)
