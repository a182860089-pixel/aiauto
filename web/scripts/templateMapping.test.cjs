const test = require('node:test')
const assert = require('node:assert/strict')
const mapping = require('./templateMapping.cjs')
test('template mapping module loads', () => assert.ok(mapping))
