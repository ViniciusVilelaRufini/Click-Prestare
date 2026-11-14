module.exports = {
  displayName: 'portaria-web',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: 'test-output/jest/coverage',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  // qrcode-generator publica CJS com `module.exports = qrcode` (sem `default`).
  // O build do app (module preserve) faz a interop sozinho; o Jest compila para
  // commonjs sem esModuleInterop e o `import qrcode from` viraria undefined.
  // A versão ESM do pacote tem `export default` e passa pelo transform acima.
  moduleNameMapper: {
    '^qrcode-generator$': '<rootDir>/../../node_modules/qrcode-generator/dist/qrcode.mjs',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
