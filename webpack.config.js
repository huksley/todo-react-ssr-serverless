const path = require('path');
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const entry = './src/entry.jsx';
const outputPath = path.resolve('./dist');
const publicPath = process.env.PUBLIC_PATH || '/';
const resolve = {
  extensions: ['.js', '.jsx'],
};

const clientConfig = {
  entry,
  target: 'web',
  devtool: process.env.NODE_ENV == 'production' ? 'nosource-source-map' : 'source-map',
  mode: process.env.NODE_ENV == 'production' ? 'production' : 'development',
  output: {
    path: outputPath,
    chunkFilename: '[name].bundle.js',
    filename: 'index.bundle.js',
    publicPath,
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: require.resolve('babel-loader')
        }
      },
      {
        test: /\.(gif|png|jpe?g|svg)$/i,
        use: [
          'file-loader',
          {
            loader: 'image-webpack-loader',
            options: {
              bypassOnDebug: true
            }
          }
        ]
      }
    ]
  },
  resolve,
  plugins: [
    // Copy all used resources (no dir available)
    new CopyWebpackPlugin([
      { from: "assets", to: "assets" },
      { from: "css", to: "css" },
      { from: "public" },
      { from: "index.html", to: "index.html", transform: (content) => {
          if (process.env.PUBLIC_PATH) {
            let path = process.env.PUBLIC_PATH;
            if (path.endsWith("/")) {
              path = path.substring(0, path.length - 1);
            }
            return String(content).replace(/{{CDN}}/g, path);
          } else {
            // Don`t use CDN
            return String(content).replace(/{{CDN}}\//g, "");
          }
        }
      }
    ]),
    // During the build make literal replacements on client side for 
    // process.env.API_URL, because there is no process.env
    new webpack.DefinePlugin({
      'process.env.API_URL': JSON.stringify(process.env.API_URL || "http://localhost:3000/api") 
    }),
  ]
};

const serverConfig = {
  entry,
  target: 'node',
  devtool: process.env.NODE_ENV == 'production' ? 'nosource-source-map' : 'source-map',
  mode: process.env.NODE_ENV == 'production' ? 'production' : 'development',
  node: {
    __dirname: false
  },
  output: {
    libraryTarget: 'commonjs2',
    path: outputPath,
    chunkFilename: '[name].server.bundle.js',
    filename: 'index.server.bundle.js',
    publicPath,
    // https://webpack.js.org/configuration/output/#output-strictmoduleexceptionhandling
    //  - When set to false, the module is not removed from cache, which results in 
    //    the exception getting thrown only on the first require call (making it incompatible with node.js).
    strictModuleExceptionHandling: true
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: require.resolve('babel-loader'),
          options: {
            presets: [
              [ '@babel/env', {
                  targets: {
                    node: '8.10'
                  }
                }
              ]
            ]
          }
        }
      },
      {
        test: /\.(gif|png|jpe?g|svg)$/i,
        use: [
          'file-loader',
          {
            loader: 'image-webpack-loader',
            options: {
              bypassOnDebug: true
            }
          }
        ]
      }
    ]
  },
  resolve,
  plugins: [
    // Assume runs last
    new CleanWebpackPlugin('dist/*.*'),
    // Copy all used resources (no dir available)
    new CopyWebpackPlugin([
      { from: "assets", to: "assets" },
      { from: "css", to: "css" },
      { from: "public" },
      { from: "index.html", to: "index.html", transform: (content) => {
          if (process.env.PUBLIC_PATH) {
            let path = process.env.PUBLIC_PATH;
            if (path.endsWith("/")) {
              path = path.substring(0, path.length - 1);
            }
            return String(content).replace(/{{CDN}}/g, path);
          } else {
            // Don`t use CDN
            return String(content).replace(/{{CDN}}\//g, "");
          }
        }
      }
    ]),
    // Limit chunks to 1 effectively disable chunking (used in dynamic imports)
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1
    })
  ]
};

module.exports = [
  clientConfig,
  serverConfig,
];
