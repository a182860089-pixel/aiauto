const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function fixtureRoot() {
  var candidates = [
    path.join(__dirname, '..', 'scripts', 'fixtures', 'platform'),
    path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'platform'),
  ]
  for (var index = 0; index < candidates.length; index += 1) {
    if (fs.existsSync(candidates[index])) return candidates[index]
  }
  return candidates[0]
}

function startPlatformFixtureServer() {
  var root = fixtureRoot()
  var server = http.createServer((request, response) => {
    var url = new URL(request.url || '/', 'http://127.0.0.1')
    var pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/index.html'
    var filePath = path.normalize(path.join(root, pathname))
    if (!filePath.startsWith(root)) {
      response.writeHead(403)
      response.end('forbidden')
      return
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('not found')
        return
      }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain; charset=utf-8' })
      response.end(data)
    })
  })
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      var address = server.address()
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
        loginUrl: `http://127.0.0.1:${address.port}/Home/Login.html`,
      })
    })
    server.on('error', reject)
  })
}

module.exports = { startPlatformFixtureServer, fixtureRoot }
