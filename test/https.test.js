import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { WasabiClient, WasabiTransportError } from 'wasabi-api-node'

const execFileAsync = promisify(execFile)
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

  // Trust the test CA at startup without changing production TLS validation.
  // Preserve loaders supplied through Node flags; NODE_OPTIONS is inherited below.
  const { stdout } = await execFileAsync(process.execPath, [...process.execArgv, '--input-type=module', '--eval', `
    import { WasabiClient } from 'wasabi-api-node'
    const client = new WasabiClient(${JSON.stringify(options)})
    const status = await client.getStatus()
    const loading = await client.loadWallet(['Savings / é?#%'])
    const wallet = client.wallet('Savings / é?#%')
    const info = await wallet.getWalletInfo()
    console.log(JSON.stringify({ status, loading, walletName: wallet.walletName, info }))
  `], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certificatePath },
    timeout: 5000
  })
  assert.deepEqual(JSON.parse(stdout), {
    status: { jsonrpc: '2.0', id: calls[0].payload.id, result: { ok: true } },
    loading: { jsonrpc: '2.0', id: calls[1].payload.id },
    walletName: 'Savings / é?#%',
    info: { jsonrpc: '2.0', id: calls[2].payload.id, result: { ok: true } }
  })
  assert.deepEqual(calls.map((call) => call.url), ['/', '/', '/Savings%20%2F%20%C3%A9%3F%23%25'])
  assert.deepEqual(calls.map((call) => call.payload.method), ['getstatus', 'loadwallet', 'getwalletinfo'])
  assert.deepEqual(calls[1].payload.params, ['Savings / é?#%'])
  assert.ok(calls.every((call) => call.headers.authorization === `Basic ${Buffer.from('rpc-user:rpc-password').toString('base64')}`))
})
