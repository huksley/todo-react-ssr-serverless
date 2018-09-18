const path = require('path');
const serverless = require('serverless-webpack');
const nodeExternals = require('webpack-node-externals');
const webpack = require('webpack');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const resolve = {
  extensions: ['.js', '.jsx'],
};

const config = {
  entry: serverless.lib.entries,
  mode: serverless.lib.webpack.isLocal ? 'development' : 'production',
  target: 'node',
  node: {
    __dirname: false
  },
  optimization: {
    // We no not want to minimize our code.
    minimize: false
  },
  devtool: serverless.lib.webpack.isLocal ? 'source-map' : 'source-map',
  externals: [ nodeExternals() ],
  output: {
    libraryTarget: 'commonjs2',
    // Write to folder which serverless-webpack expects
    path: path.resolve(__dirname, '.webpack'),
    filename: '[name].js',
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
  // For serverless, everything needed must be copied to output folder
  plugins: [
    // Copy all used resources (no dir available)
    new CopyWebpackPlugin([
      { from: "dist", to: "dist" }
    ]),
    // Limit chunks to 1 effectively disable chunking (used in dynamic imports)
    // Dos not 
    new webpack.optimize.LimitChunkCountPlugin({
      maxChunks: 1
    })
  ]
};

// Never export multiple or 1-array entries, as serverless-webpack cannot handle those
module.exports = config;
