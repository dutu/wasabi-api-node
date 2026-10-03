import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createConnection, createServer as createTcpServer } from 'node:net'
import { setImmediate as nextTurn } from 'node:timers/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { getGlobalDispatcher } from 'undici'
import { WasabiClient, WasabiHttpError, WasabiResponseError, WasabiRpcError, WasabiTransportError } from 'wasabi-api-node'

const credentials = { rpcUrl: 'http://127.0.0.1:37128/', rpcUsername: 'rpc-user', rpcPassword: 'rpc-password' }
const onionHost = `${'a'.repeat(56)}.onion`
const certificatePath = fileURLToPath(new URL('./fixtures/proxy-cert.pem', import.meta.url))
const execFileAsync = promisify(execFile)

const createFixture = async function createFixture(context, {
  authentication,
  rejectAuthentication = false,
  rejectConnect = false,
  stallHandshake = false,
  fragmentReplies = false,
  secure = false,
  reply = (request) => ({ jsonrpc: '2.0', id: request.id, result: { ok: true } })
} = {}) {
  const requests = []
  const destinations = []
  const proxyCredentials = []
  const sockets = new Set()

  const trackSocket = (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    return socket
  }

  const handleRequest = (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      requests.push({ url: request.url, headers: request.headers, payload })
      const result = reply(payload, response)

      if (result === undefined) {
        return
      }

      response.writeHead(result.status ?? 200, {
        'Content-Type': 'application/json',
        ...result.headers
      })
      response.end(result.body ?? JSON.stringify(result))
    })
  }
  const httpServer = secure
    ? createHttpsServer({
      key: readFileSync(new URL('./fixtures/proxy-key.pem', import.meta.url)),
      cert: readFileSync(certificatePath)
    }, handleRequest)
    : createHttpServer(handleRequest)

  const proxyServer = createTcpServer((connection) => {
    const socket = trackSocket(connection)
    let buffer = Buffer.alloc(0)
    let state = 'greeting'

    const send = (data) => {
      if (fragmentReplies) {
        socket.write(data.subarray(0, 1))
        setImmediate(() => socket.write(data.subarray(1)))
      } else {
        socket.write(data)
      }
    }

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])

      while (true) {
        if (state === 'greeting') {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) {
            return
          }

          buffer = buffer.subarray(2 + buffer[1])

          if (stallHandshake) {
            state = 'stalled'
            return
          }

          send(Buffer.from([5, authentication ? 2 : 0]))
          state = authentication ? 'authentication' : 'connect'
        } else if (state === 'authentication') {
          if (buffer.length < 2 || buffer.length < 3 + buffer[1]) {
            return
          }

          const usernameLength = buffer[1]
          const passwordLength = buffer[2 + usernameLength]
          const length = 3 + usernameLength + passwordLength

          if (buffer.length < length) {
            return
          }

          const username = buffer.subarray(2, 2 + usernameLength).toString('utf8')
          const password = buffer.subarray(3 + usernameLength, length).toString('utf8')
          proxyCredentials.push({ username, password })
          buffer = buffer.subarray(length)
          const accepted = !rejectAuthentication && username === authentication.username && password === authentication.password
          send(Buffer.from([1, accepted ? 0 : 1]))
          state = accepted ? 'connect' : 'rejected'
        } else if (state === 'connect') {
          if (buffer.length < 5) {
            return
          }

          const addressType = buffer[3]
          const addressOffset = addressType === 3 ? 5 : 4
          const addressLength = addressType === 3 ? buffer[4] : addressType === 1 ? 4 : 16
          const length = addressOffset + addressLength + 2

          if (buffer.length < length) {
            return
          }

          const address = buffer.subarray(addressOffset, addressOffset + addressLength)
          const hostname = addressType === 3 ? address.toString('utf8') : [...address].join('.')
          const port = buffer.readUInt16BE(addressOffset + addressLength)
          destinations.push({ addressType, hostname, port })
          buffer = buffer.subarray(length)
          state = 'tunnel'

          if (rejectConnect) {
            send(Buffer.from([5, 5, 0, 1, 127, 0, 0, 1, 0, 0]))
            return
          }

          socket.pause()
          socket.removeListener('data', onData)
          // Map synthetic onion names to this local fixture without resolving them.
          const upstream = trackSocket(createConnection({ host: '127.0.0.1', port: httpServer.address().port }))
          socket.once('close', () => upstream.destroy())
          upstream.once('error', () => socket.destroy())
          upstream.once('connect', () => {
            send(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))

            if (buffer.length > 0) {
              upstream.write(buffer)
            }

            socket.pipe(upstream)
            upstream.pipe(socket)
            socket.resume()
          })
          return
        } else {
          return
        }
      }
    }

    socket.on('data', onData)
  })

  context.after(async () => {
    for (const socket of sockets) {
      socket.destroy()
    }

    httpServer.closeAllConnections()
    await Promise.all([httpServer, proxyServer].map((server) => new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve()
        return
      }

      server.close((error) => error ? reject(error) : resolve())
    })))
  })

  httpServer.listen(0, '127.0.0.1')
  await once(httpServer, 'listening')
  proxyServer.listen(0, '127.0.0.1')
  await once(proxyServer, 'listening')

  const proxyUrl = `socks5h://127.0.0.1:${proxyServer.address().port}`
  const directUrl = `http://127.0.0.1:${httpServer.address().port}/`
  const client = (options = {}) => new WasabiClient({ ...credentials, rpcUrl: `http://${onionHost}/`, proxyUrl, ...options })

  return { client, proxyUrl, directUrl, requests, destinations, proxyCredentials, sockets, proxyServer }
}

const waitForProxyConnectionsToClose = async function waitForProxyConnectionsToClose(fixture) {
  await Promise.all([...fixture.sockets].map((socket) => once(socket, 'close', { signal: AbortSignal.timeout(1000) })))
  assert.equal(fixture.sockets.size, 0)
}

for (const scheme of ['socks5h', 'socks5']) {
  test(`${scheme} resolves onion destinations through the proxy for root and wallet requests`, async (context) => {
    const fixture = await createFixture(context)
    const client = fixture.client({ proxyUrl: fixture.proxyUrl.replace('socks5h:', `${scheme}:`) })
    const status = await client.getStatus()
    await waitForProxyConnectionsToClose(fixture)
    const info = await client.wallet('Savings é?#').getWalletInfo()
    await waitForProxyConnectionsToClose(fixture)
    assert.deepEqual(status, { jsonrpc: '2.0', id: fixture.requests[0].payload.id, result: { ok: true } })
    assert.deepEqual(info, { jsonrpc: '2.0', id: fixture.requests[1].payload.id, result: { ok: true } })
    assert.equal(fixture.destinations.length, 2)
    assert.ok(fixture.destinations.every((destination) => destination.addressType === 3 && destination.hostname === onionHost && destination.port === 80))
    assert.deepEqual(fixture.requests.map((request) => request.url), ['/', '/Savings%20%C3%A9%3F%23'])
    assert.ok(fixture.requests.every((request) => request.headers.host === onionHost))
    assert.ok(fixture.requests.every((request) => request.headers.authorization === `Basic ${Buffer.from('rpc-user:rpc-password').toString('base64')}`))
  })
}

test('preserves a custom destination port and named load parameters through SOCKS', async (context) => {
  const fixture = await createFixture(context, { reply: (request) => ({ jsonrpc: '2.0', id: request.id }) })
  const response = await fixture.client({ rpcUrl: `http://${onionHost}:37128/` }).loadWallet({ walletName: 'Savings' })
  assert.deepEqual(response, { jsonrpc: '2.0', id: fixture.requests[0].payload.id })
  assert.equal(fixture.destinations[0].port, 37128)
  assert.equal(fixture.requests[0].headers.host, `${onionHost}:37128`)
  assert.deepEqual(fixture.requests[0].payload.params, { walletName: 'Savings' })
})

test('proxy authentication is URL-decoded and separate from RPC Basic Auth', async (context) => {
  const authentication = { username: 'proxy é', password: 'proxy:pass?#%' }
  const fixture = await createFixture(context, { authentication })
  const proxyUrl = fixture.proxyUrl.replace('://', `://${encodeURIComponent(authentication.username)}:${encodeURIComponent(authentication.password)}@`)
  await fixture.client({ proxyUrl }).listWallets()
  assert.deepEqual(fixture.proxyCredentials[0], authentication)
  assert.equal(fixture.requests[0].headers.authorization, `Basic ${Buffer.from('rpc-user:rpc-password').toString('base64')}`)
  assert.equal(fixture.requests[0].headers['proxy-authorization'], undefined)
})

test('handles fragmented SOCKS replies', async (context) => {
  const fixture = await createFixture(context, { fragmentReplies: true })
  const response = await fixture.client().getStatus()
  assert.deepEqual(response, { jsonrpc: '2.0', id: fixture.requests[0].payload.id, result: { ok: true } })
})

test('HTTPS stays encrypted through the proxy and validates the destination certificate', async (context) => {
  const fixture = await createFixture(context, { secure: true })
  const rpcUrl = 'https://rpc.test.invalid/'
  await assert.rejects(fixture.client({ rpcUrl }).getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.equal(error.cause.cause.code, 'DEPTH_ZERO_SELF_SIGNED_CERT')
    return true
  })
  assert.equal(fixture.requests.length, 0)

  // Trust only this fixture in a child process; TLS verification remains enabled.
  // Preserve loaders supplied through Node flags; NODE_OPTIONS is inherited below.
  const { stdout } = await execFileAsync(process.execPath, [...process.execArgv, '--input-type=module', '--eval', `
    import assert from 'node:assert/strict'
    import { WasabiClient } from 'wasabi-api-node'
    const options = ${JSON.stringify({ ...credentials, rpcUrl, proxyUrl: fixture.proxyUrl })}
    const client = new WasabiClient(options)
    console.log(JSON.stringify(await client.getStatus()))

    // A trusted certificate must still match the destination hostname.
    const mismatch = new WasabiClient({ ...options, rpcUrl: 'https://wrong-host.invalid/' })
    await assert.rejects(mismatch.getStatus(), (error) => {
      assert.equal(error.cause.cause.code, 'ERR_TLS_CERT_ALTNAME_INVALID')
      return true
    })
  `], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certificatePath },
    timeout: 5000
  })
  assert.deepEqual(JSON.parse(stdout), { jsonrpc: '2.0', id: fixture.requests[0].payload.id, result: { ok: true } })
  assert.ok(fixture.destinations.some((destination) => destination.hostname === 'rpc.test.invalid' && destination.port === 443))
  assert.equal(fixture.requests[0].headers.host, 'rpc.test.invalid')
  assert.equal(fixture.requests.length, 1)
  await waitForProxyConnectionsToClose(fixture)
})

test('an unreachable proxy rejects without falling back to the RPC endpoint', async (context) => {
  const fixture = await createFixture(context)
  await new Promise((resolve, reject) => fixture.proxyServer.close((error) => error ? reject(error) : resolve()))
  await assert.rejects(fixture.client({ rpcUrl: fixture.directUrl }).getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.match(error.cause.cause.message, /ECONNREFUSED/u)
    return true
  })
  assert.equal(fixture.requests.length, 0)
})

test('does not fall back to the RPC endpoint when SOCKS CONNECT fails', async (context) => {
  const fixture = await createFixture(context, { rejectConnect: true })

  await assert.rejects(fixture.client({ rpcUrl: fixture.directUrl }).getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.match(error.cause.cause.message, /Socks5 proxy rejected connection/u)
    return true
  })

  assert.equal(fixture.requests.length, 0)
})

test('proxy authentication failures reject without sending RPC credentials', async (context) => {
  const authentication = { username: 'proxy-user', password: 'proxy-password' }
  const fixture = await createFixture(context, { authentication, rejectAuthentication: true })
  const proxyUrl = fixture.proxyUrl.replace('://', '://proxy-user:proxy-password@')

  await assert.rejects(fixture.client({ proxyUrl }).getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.match(error.cause.cause.message, /Socks5 authentication failed/iu)
    return true
  })

  assert.equal(fixture.requests.length, 0)
})

test('HTTP and JSON-RPC errors retain their public error types through a proxy', async (context) => {
  const fixture = await createFixture(context, {
    reply: (request) => request.method === 'getstatus'
      ? { status: 401, body: 'Unauthorized' }
      : { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Wallet not loaded' } }
  })
  const client = fixture.client()
  await assert.rejects(client.getStatus(), { name: WasabiHttpError.name, status: 401, body: 'Unauthorized' })
  await assert.rejects(client.wallet('Savings').getHistory(), { name: WasabiRpcError.name, code: -32603 })
})

test('rejectRpcErrors=false returns wallet RPC errors unchanged through a proxy while HTTP failures still reject', async (context) => {
  const rpcError = { code: -32603, message: 'Wallet not loaded', data: { raw: true }, future: ['preserved'] }
  const fixture = await createFixture(context, {
    reply: (request) => request.method === 'getstatus'
      ? { status: 401, body: 'Unauthorized' }
      : { jsonrpc: '2.0', id: request.id, error: rpcError }
  })
  const client = fixture.client({ rejectRpcErrors: false })
  await assert.rejects(client.getStatus(), { name: WasabiHttpError.name, status: 401 })
  const wallet = client.wallet('Savings')
  assert.equal(fixture.requests.length, 1)
  const response = await wallet.getHistory()
  assert.deepEqual(response, { jsonrpc: '2.0', id: fixture.requests[1].payload.id, error: rpcError })
  assert.equal(fixture.requests.length, 2)
  assert.equal(fixture.requests[1].payload.method, 'gethistory')
})

test('redirects through a proxy are reported without following the new destination', async (context) => {
  const fixture = await createFixture(context, {
    reply: () => ({ status: 302, headers: { Location: 'http://another-host.invalid/' }, body: '' })
  })
  await assert.rejects(fixture.client().getStatus(), { name: WasabiHttpError.name, status: 302 })
  assert.equal(fixture.requests.length, 1)
  assert.ok(fixture.destinations.every((destination) => destination.hostname === onionHost))
})

test('request timeout covers a stalled proxy handshake', async (context) => {
  const fixture = await createFixture(context, { stallHandshake: true })
  const client = fixture.client({ timeoutMs: 100 })

  await assert.rejects(client.getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.equal(error.cause.name, 'TimeoutError')
    return true
  })

  assert.equal(fixture.requests.length, 0)
  await waitForProxyConnectionsToClose(fixture)
})

test('each proxied request owns a dispatcher without changing the global dispatcher', async (context) => {
  const globalDispatcher = getGlobalDispatcher()
  const dispatchers = []
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    dispatchers.push(options.dispatcher)
    const request = JSON.parse(options.body)
    return Response.json({ jsonrpc: '2.0', id: request.id, result: {} })
  })
  const first = new WasabiClient({ ...credentials, proxyUrl: 'socks5h://127.0.0.1:9050' })
  const second = new WasabiClient({ ...credentials, proxyUrl: 'socks5://127.0.0.1:9150' })
  await first.getStatus()
  await first.wallet('Savings').getWalletInfo()
  await second.getStatus()
  await new WasabiClient(credentials).getStatus()
  assert.notEqual(dispatchers[0], dispatchers[1])
  assert.notEqual(dispatchers[0], dispatchers[2])
  assert.equal(dispatchers[3], undefined)
  assert.ok(dispatchers.slice(0, 3).every((dispatcher) => dispatcher.destroyed))
  assert.equal(getGlobalDispatcher(), globalDispatcher)
})

test('proxy cleanup waits for the response body before the next queued request', async (context) => {
  let controller
  let firstRequest
  const calls = []
  const dispatchers = []
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = JSON.parse(options.body)
    calls.push(request.method)
    dispatchers.push(options.dispatcher)

    if (calls.length === 1) {
      firstRequest = request
      return new Response(new ReadableStream({ start(streamController) { controller = streamController } }))
    }

    return Response.json({ jsonrpc: '2.0', id: request.id, result: [] })
  })
  const client = new WasabiClient({ ...credentials, proxyUrl: 'socks5h://127.0.0.1:9050' })
  const wallet = client.wallet('Savings')
  const status = client.getStatus()
  const coins = wallet.listCoins()
  await nextTurn()
  assert.deepEqual(calls, ['getstatus'])
  assert.equal(dispatchers[0].destroyed, false)
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: firstRequest.id, result: {} })))
  controller.close()
  await Promise.all([status, coins])
  assert.deepEqual(calls, ['getstatus', 'listcoins'])
  assert.notEqual(dispatchers[0], dispatchers[1])
  assert.ok(dispatchers.every((dispatcher) => dispatcher.destroyed))
})

for (const [label, reply, errorClass, rejectRpcErrors] of [
  ['HTTP error', () => ({ status: 401, body: 'Unauthorized' }), WasabiHttpError, true],
  ['RPC rejection', (request) => ({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Failed' } }), WasabiRpcError, true],
  ['RPC error returned normally', (request) => ({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Failed' } }), undefined, false],
  ['non-JSON response', () => ({ body: 'not JSON' }), WasabiResponseError, true],
  ['mismatched ID', () => ({ jsonrpc: '2.0', id: 'wrong', result: {} }), WasabiResponseError, false]
]) {
  test(`automatically releases proxy connections after ${label} and permits another call`, async (context) => {
    const fixture = await createFixture(context, {
      reply: (request, response) => request.method === 'getstatus'
        ? reply(request, response)
        : { jsonrpc: '2.0', id: request.id, result: [] }
    })
    const client = fixture.client({ rejectRpcErrors })

    if (errorClass) {
      await assert.rejects(client.getStatus(), errorClass)
    } else {
      const response = await client.getStatus()
      assert.deepEqual(response.error, { code: -32603, message: 'Failed' })
    }

    await waitForProxyConnectionsToClose(fixture)
    const response = await client.wallet('Savings').listCoins()
    assert.deepEqual(response.result, [])
    await waitForProxyConnectionsToClose(fixture)
    assert.equal(fixture.destinations.length, 2)
    assert.deepEqual(fixture.requests.map(({ payload }) => payload.method), ['getstatus', 'listcoins'])
  })
}

test('automatically releases a proxy tunnel when reading the response body times out', async (context) => {
  const fixture = await createFixture(context, {
    reply: (request, response) => {
      if (request.method === 'getstatus') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.write('{"jsonrpc":"2.0",')
        return
      }

      return { jsonrpc: '2.0', id: request.id, result: [] }
    }
  })
  const client = fixture.client({ timeoutMs: 200 })
  const results = await Promise.allSettled([client.getStatus(), client.listWallets()])
  assert.equal(results[0].status, 'rejected')
  assert.ok(results[0].reason instanceof WasabiTransportError)
  assert.equal(results[0].reason.cause.name, 'TimeoutError')
  assert.equal(results[1].status, 'fulfilled')
  assert.deepEqual(results[1].value.result, [])
  await waitForProxyConnectionsToClose(fixture)
  assert.equal(fixture.destinations.length, 2)
})

test('automatically releases a proxy tunnel when the response body connection breaks', async (context) => {
  const fixture = await createFixture(context, {
    reply: (request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' })
      response.write('{"jsonrpc":"2.0",')
      setImmediate(() => response.destroy())
    }
  })
  await assert.rejects(fixture.client().getStatus(), WasabiTransportError)
  await waitForProxyConnectionsToClose(fixture)
})

for (const failRequest of [false, true]) {
  test(`proxy cleanup failures reject without losing an earlier request error: failRequest=${failRequest}`, async (context) => {
    const requestError = new Error('Request failed')
    const cleanupError = new Error('Cleanup failed')
    context.mock.method(globalThis, 'fetch', async (url, options) => {
      context.mock.method(options.dispatcher, 'destroy', async () => {
        throw cleanupError
      })

      if (failRequest) {
        throw requestError
      }

      const request = JSON.parse(options.body)
      return Response.json({ jsonrpc: '2.0', id: request.id, result: {} })
    })
    const client = new WasabiClient({ ...credentials, proxyUrl: 'socks5h://127.0.0.1:9050' })
    await assert.rejects(client.getStatus(), (error) => {
      assert.ok(error instanceof WasabiTransportError)

      if (failRequest) {
        assert.ok(error.cause instanceof AggregateError)
        assert.deepEqual(error.cause.errors, [requestError, cleanupError])
      } else {
        assert.equal(error.cause, cleanupError)
      }

      return true
    })
  })
}

for (const proxyUrl of [
  'socks5://127.0.0.1',
  'socks5h://localhost/',
  'socks5h://user:password@127.0.0.1',
  'socks5://[::1]',
  'socks5h://127.0.0.1:'
]) {
  test(`requires an explicit proxy port in ${proxyUrl}`, () => {
    assert.throws(() => new WasabiClient({ ...credentials, proxyUrl }), {
      name: 'TypeError',
      message: 'proxyUrl must include an explicit port'
    })
  })
}

test('accepts an explicitly specified standard SOCKS port', () => {
  assert.doesNotThrow(() => new WasabiClient({ ...credentials, proxyUrl: 'socks5h://127.0.0.1:1080' }))
})

for (const proxyUrl of [
  null,
  '',
  'not a URL',
  'http://127.0.0.1:9050',
  'socks4://127.0.0.1:9050',
  'socks5://127.0.0.1:0',
  'socks5://127.0.0.1:65536',
  'socks5://127.0.0.1:9050/path',
  'socks5://127.0.0.1:9050?query=value',
  'socks5://127.0.0.1:9050#fragment',
  'socks5://user@127.0.0.1:9050',
  'socks5://:password@127.0.0.1:9050',
  'socks5://%ZZ:password@127.0.0.1:9050',
  `socks5://${'x'.repeat(256)}:password@127.0.0.1:9050`
]) {
  test(`rejects invalid proxy URL ${JSON.stringify(proxyUrl)}`, () => {
    assert.throws(() => new WasabiClient({ ...credentials, proxyUrl }), TypeError)
  })
}
