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
      filename: 'index.js',
      libraryTarget: 'commonjs',
      path: path.resolve(__dirname, 'build')
    },
  };