/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

// Testes rodam no mesmo fuso do servidor de produção (Railway = UTC). Sem
// isto, a máquina do dev (America/Sao_Paulo) esconde os bugs de fuso — o
// código passaria no teste local e quebraria em produção. Precisa ser aqui
// (processo do worker) porque process.env.TZ mexido dentro do sandbox do Jest
// não chega no cache de timezone do Node.
process.env.TZ = 'UTC';

module.exports = {
  displayName: '@org/api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
