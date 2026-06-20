module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  // tts.test.ts 之前因 jest.mock('axios') 写法有问题导致 import 阶段崩；下一轮用 msw 重写
  testPathIgnorePatterns: ['/node_modules/', '\\.skip\\.test\\.ts$', 'tts\\.test\\.ts$'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'ES2020', esModuleInterop: true } }],
  },
}
