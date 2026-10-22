import path from 'node:path';
import { minimizeTrait } from './traits.config.js';

// externalize SpecLynx ApiDOM — resolved at runtime by the consumer. Externals
// match the request as written, before resolve.alias, so redirects happen here.
const externalizeSpecLynx = (type) => {
  // redirect swagger-api ApiDOM to SpecLynx ApiDOM at build time
  const apidomRedirects = {
    '@swagger-api/apidom-error': '@speclynx/apidom-error',
    '@swagger-api/apidom-reference/configuration/empty':
      '@speclynx/apidom-reference/configuration/empty',
  };

  return function ({ request }, callback) {
    const target = apidomRedirects[request] ?? request;
    if (target && target.startsWith('@speclynx/')) {
      return callback(null, `${type} ${target}`);
    }
    callback();
  };
};

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
    fallback: {
      fs: false,
      path: false,
      module: false,
    },
  },
  externals: [externalizeSpecLynx('module')],
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
  externals: [externalizeSpecLynx('commonjs')],
};

export default [swaggerClientExecuteES, swaggerClientExecuteCJS];
