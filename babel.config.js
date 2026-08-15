// Babel config used ONLY by jest (via babel-jest) to downlevel the handful of
// ESM-only dependencies (nostr-tools, @noble/*, @scure/*) into CommonJS so they
// can be required from the test runtime. Application builds use tsc/swc, not babel.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
