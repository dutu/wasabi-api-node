import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Agent, getGlobalDispatcher } from 'undici'
import { WasabiClient, WasabiTransportError } from 'wasabi-api-node'

const certificatePath = fileURLToPath(new URL('./fixtures/proxy-cert.pem', import.meta.url))

test('HTTPS reverse proxies preserve authentication, encoded wallet paths and parameter arrays', async (context) => {
  const calls = []
  const upstream = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      calls.push({ url: request.url, headers: request.headers, payload })
      const reply = { jsonrpc: '2.0', id: payload.id }

      if (payload.method !== 'loadwallet') {
        reply.result = { ok: true }
      }

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(reply))
    })
  })
  const reverseProxy = createHttpsServer({
    key: readFileSync(new URL('./fixtures/proxy-key.pem', import.meta.url)),
    cert: readFileSync(certificatePath)
  }, (request, response) => {
    const forwarded = httpRequest({
      hostname: '127.0.0.1',
      port: upstream.address().port,
      path: request.url.slice('/wasabi'.length),
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${upstream.address().port}` }
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    forwarded.on('error', (error) => response.destroy(error))
    request.pipe(forwarded)
  })

  context.after(async () => {
    await Promise.all([reverseProxy, upstream].map((server) => {
      server.closeAllConnections()
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }))
  })

  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  reverseProxy.listen(0, '127.0.0.1')
  await once(reverseProxy, 'listening')
  const options = {
    rpcUrl: `https://127.0.0.1:${reverseProxy.address().port}/wasabi/`,
    rpcUsername: 'rpc-user',
    rpcPassword: 'rpc-password'
  }
  const untrusted = new WasabiClient(options)
  await assert.rejects(untrusted.getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.equal(error.cause.cause.code, 'DEPTH_ZERO_SELF_SIGNED_CERT')
    return true
  })
  assert.equal(calls.length, 0)

  const globalDispatcher = getGlobalDispatcher()
  const dispatcher = new Agent({ connect: { ca: readFileSync(certificatePath) } })
  context.after(() => dispatcher.destroy())
  const client = new WasabiClient({ ...options, dispatcher })
  const status = await client.getStatus()
  const loading = await client.loadWallet(['Savings / é?#%'])
  const wallet = client.wallet('Savings / é?#%')
  const info = await wallet.getWalletInfo()
  assert.deepEqual({ status, loading, walletName: wallet.walletName, info }, {
    status: { jsonrpc: '2.0', id: calls[0].payload.id, result: { ok: true } },
    loading: { jsonrpc: '2.0', id: calls[1].payload.id },
    walletName: 'Savings / é?#%',
    info: { jsonrpc: '2.0', id: calls[2].payload.id, result: { ok: true } }
  })
  assert.deepEqual(calls.map((call) => call.url), ['/', '/', '/Savings%20%2F%20%C3%A9%3F%23%25'])
  assert.deepEqual(calls.map((call) => call.payload.method), ['getstatus', 'loadwallet', 'getwalletinfo'])
  assert.deepEqual(calls[1].payload.params, ['Savings / é?#%'])
  assert.ok(calls.every((call) => call.headers.authorization === `Basic ${Buffer.from('rpc-user:rpc-password').toString('base64')}`))
  assert.equal(dispatcher.closed, false)
  assert.equal(dispatcher.destroyed, false)
  assert.equal(getGlobalDispatcher(), globalDispatcher)
  await assert.rejects(new WasabiClient(options).getStatus(), WasabiTransportError)
  assert.equal(calls.length, 3)
})

test('caller-supplied dispatchers support mutual TLS and sharing between clients', async (context) => {
  const cert = readFileSync(certificatePath)
  const key = readFileSync(new URL('./fixtures/proxy-key.pem', import.meta.url))
  const server = createHttpsServer({ key, cert, ca: cert, requestCert: true }, (request, response) => {
    assert.equal(request.socket.authorized, true)
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { authorized: true } }))
    })
  })
  context.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const options = {
    rpcUrl: `https://127.0.0.1:${server.address().port}/`,
    rpcUsername: 'rpc-user',
    rpcPassword: 'rpc-password'
  }
  const withoutCertificate = new Agent({ connect: { ca: cert } })
  const dispatcher = new Agent({ connect: { ca: cert, cert, key } })
  context.after(() => Promise.all([withoutCertificate.destroy(), dispatcher.destroy()]))
  await assert.rejects(new WasabiClient({ ...options, dispatcher: withoutCertificate }).getStatus(), WasabiTransportError)
  assert.equal(withoutCertificate.closed, false)
  assert.equal(withoutCertificate.destroyed, false)

  const client = new WasabiClient({ ...options, dispatcher })
  const sharedClient = new WasabiClient({ ...options, dispatcher })
  for (const response of await Promise.all([client.getStatus(), sharedClient.wallet('Savings').getWalletInfo()])) {
    assert.deepEqual(response.result, { authorized: true })
  }
  assert.equal(dispatcher.closed, false)
  assert.equal(dispatcher.destroyed, false)
})
