/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFiles: ["<rootDir>/tests/jest.setup.js"],
  testTimeout: 30_000,
  // Ink's React reconciler can leave async handles open after tests finish;
  // forceExit ensures the Jest process exits cleanly.
  forceExit: true,
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleFileExtensions: ["ts", "tsx", "js", "mjs", "cjs", "jsx", "json", "node"],
  // Source imports use explicit .js extensions (required for the real ESM
  // build); strip them back off so Jest's resolver finds the .ts source.
  // Workspace packages resolve straight to their TypeScript sources so the
  // suite runs without a prior build.
  moduleNameMapper: {
    "^@nemesis-oss/nexum-core$": "<rootDir>/packages/core/src/index.ts",
    "^@nemesis-oss/nexum-core/(.*)$": "<rootDir>/packages/core/src/$1",
    "^@nemesis-oss/nexum-models$": "<rootDir>/packages/models/src/index.ts",
    "^@nemesis-oss/nexum-models/(.*)$": "<rootDir>/packages/models/src/$1",
    "^@nemesis-oss/nexum-tools$": "<rootDir>/packages/tools/src/index.ts",
    "^@nemesis-oss/nexum-tools/(.*)$": "<rootDir>/packages/tools/src/$1",
    "^@nemesis-oss/nexum-mcp$": "<rootDir>/packages/mcp/src/index.ts",
    "^@nemesis-oss/nexum-mcp/(.*)$": "<rootDir>/packages/mcp/src/$1",
    "^@nemesis-oss/nexum-devagent$": "<rootDir>/packages/devagent/src/index.ts",
    "^@nemesis-oss/nexum-devagent/(.*)$": "<rootDir>/packages/devagent/src/$1",
    "^@nemesis-oss/nexum/(.*)$": "<rootDir>/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    // Include .js so the setup file (which uses ESM import) is transformed
    // through ts-jest instead of being loaded raw, which fails under
    // --experimental-vm-modules when setupFiles doesn't go through transforms.
    "^.+\\.(tsx?|js)$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.test.json",
        // Transpile-only: type errors from the @jest/globals vs @types/jest
        // ambient-type overlap (see tests/jest.setup.js) shouldn't block test
        // execution — `tsc --noEmit` on the real tsconfig is the actual type
        // gate (see package.json build/lint scripts), this is just runtime.
        // isolatedModules is set in tsconfig.json's compilerOptions (ts-jest v30
        // moved it there from this transform option, which is now deprecated).
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
};
