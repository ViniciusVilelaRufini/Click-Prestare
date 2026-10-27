const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      // src/assets vai para dist/assets, servido na raiz do site: nada de
      // .json/credencial (a chave do Firebase do dev mora ali, gitignored).
      assets: [
        {
          input: './src/assets',
          glob: '**/*',
          output: 'assets',
          ignore: ['**/*.json', '**/*service-account*', '**/.env*'],
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
