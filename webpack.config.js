const path = require('path');
var nodeExternals = require('webpack-node-externals');

module.exports = {
    // Other webpack configuration options...
    mode: 'production',
    // Specify the main entry point for your application
    entry: './jsbuild/index.js',
    target: 'node', // use require() & use NodeJs CommonJS style
    externals: [nodeExternals()], // in order to ignore all modules in node_modules folder
    externalsPresets: {
        node: true // in order to ignore built-in modules like path, fs, etc. 
    },
    // Specify where the output bundle should be created
    output: {
      filename: 'bundle.js',
      libraryTarget: 'commonjs',
      path: path.resolve(__dirname, 'build')
    },
  
    // Specify modules to exclude from processing by webpack
    module: {
      rules: [
        {
          // Exclude node_modules directory
          exclude: /node_modules/,
          // Use appropriate loader for your project's files
          // Example: Babel loader for JavaScript/TypeScript files
          test: /\.js$/,
          use: 'babel-loader'
        },
      ],
    },
  };