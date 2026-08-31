const { spawn } = require('node:child_process')
const path = require('node:path')
const electron = require('electron')

process.env.AIAUTO_FIXTURE_TEST = '1'
const child = spawn(electron, [path.join(__dirname, '..', 'electron', 'main.cjs')], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
})
child.on('exit', (code) => process.exit(code ?? 1))
