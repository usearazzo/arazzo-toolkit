import path from 'node:path';
import { minimizeTrait } from './traits.config.js';

const swaggerClientExecuteES = {
  mode: 'production',
  entry: ['./config/webpack/swagger-client-entry.js'],
  target: 'browserslist:isomorphic-production',
  experiments: {
    outputModule: true,
  },
  performance: {
    hints: false,
  },
  output: {
    path: path.resolve('./src/vendor'),
    filename: 'swagger-client.mjs',
    module: true,
    library: {
      type: 'module',
    },
  },
  resolve: {
    extensions: ['.mjs', '.js'],
    alias: {
      // redirect swagger-api ApiDOM to SpecLynx ApiDOM at build time
      '@swagger-api/apidom-error': '@speclynx/apidom-error',
      '@swagger-api/apidom-reference/configuration/empty':
        '@speclynx/apidom-reference/configuration/empty',
    },
    fallback: {
      fs: false,
      path: false,
      module: false,
    },
  },
  externals: [
    // externalize SpecLynx ApiDOM — resolved at runtime by the consumer
    function ({ request }, callback) {
      if (request && request.startsWith('@speclynx/')) {
        return callback(null, `module ${request}`);
      }
      callback();
    },
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        include: [path.resolve('./node_modules/swagger-client')],
        use: {
          loader: 'babel-loader',
          options: {
            babelrc: true,
            rootMode: 'upward',
          },
        },
      },
    ],
  },
  ...minimizeTrait,
};

const swaggerClientExecuteCJS = {
  ...swaggerClientExecuteES,
  experiments: {
    outputModule: false,
  },
  output: {
    path: path.resolve('./src/vendor'),
    filename: 'swagger-client.cjs',
    module: false,
    chunkFormat: 'commonjs',
    library: {
      type: 'commonjs2',
    },
  },
  // keep node builtins (buffer) external, as the ES build does, instead of bundling polyfills
  externalsPresets: {
    node: true,
  },
  externals: [
    // externalize SpecLynx ApiDOM — resolved at runtime by the consumer
    function ({ request }, callback) {
      if (request && request.startsWith('@speclynx/')) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ],
};

export default [swaggerClientExecuteES, swaggerClientExecuteCJS];
