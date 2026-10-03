import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import {
  WasabiClient,
  WasabiError,
  WasabiTransportError,
  WasabiHttpError,
  WasabiResponseError,
  WasabiRpcError
} from 'wasabi-api-node'

const credentials = { rpcUrl: 'http://127.0.0.1:37128/', rpcUsername: 'rpc-user', rpcPassword: 'rpc-password' }

const mockRpc = function mockRpc(context, reply = (request) => ({ jsonrpc: '2.0', id: request.id, result: {} })) {
  const calls = []

  context.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = JSON.parse(options.body)
    calls.push({ url, options, request })
    const result = await reply(request, options)
    return result instanceof Response ? result : Response.json(result)
  })

  return calls
}

for (const method of ['getStatus', 'listWallets', 'getFeeRates', 'stop']) {
  test(`${method} uses the configured root endpoint without params`, async (context) => {
    const calls = mockRpc(context)
    const response = await new WasabiClient(credentials)[method]()
    assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result: {} })
    assert.equal(calls[0].url, 'http://127.0.0.1:37128/')
    assert.equal(calls[0].request.method, method.toLowerCase())
    assert.equal(calls[0].request.jsonrpc, '2.0')
    assert.equal(Object.hasOwn(calls[0].request, 'params'), false)
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
    assert.equal(calls[0].options.headers.Accept, 'application/json')
    assert.equal(calls[0].options.redirect, 'manual')
    assert.ok(calls[0].options.signal instanceof AbortSignal)
    assert.equal(Object.hasOwn(calls[0].options, 'dispatcher'), false)
  })
}

test('forwards a caller-owned dispatcher without cleaning it up after success or failure', async (context) => {
  const failure = new TypeError('fetch failed')
  const calls = mockRpc(context, (request) => {
    if (request.method === 'listwallets') {
      throw failure
    }
    return { jsonrpc: '2.0', id: request.id, result: {} }
  })
  const dispatcher = {
    dispatch: context.mock.fn(),
    close: context.mock.fn(),
    destroy: context.mock.fn()
  }
  const options = { ...credentials, dispatcher }
  const client = new WasabiClient(options)
  options.dispatcher = undefined
  await client.getStatus()
  await assert.rejects(client.listWallets(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.equal(error.cause, failure)
    return true
  })
  await client.wallet('Savings').getWalletInfo()
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.options.dispatcher === dispatcher))
  assert.equal(dispatcher.close.mock.callCount(), 0)
  assert.equal(dispatcher.destroy.mock.callCount(), 0)
})

for (const method of ['getWalletInfo', 'getHistory', 'listCoins', 'listUnspentCoins', 'listKeys', 'listPaymentsInCoinJoin', 'stopCoinJoin']) {
  test(`${method} uses the wallet endpoint without params`, async (context) => {
    const calls = mockRpc(context)
    const wallet = new WasabiClient(credentials).wallet('Wallet')
    const response = await wallet[method]()
    assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result: {} })
    assert.equal(calls[0].url, 'http://127.0.0.1:37128/Wallet')
    assert.equal(calls[0].request.method, method.toLowerCase())
    assert.equal(Object.hasOwn(calls[0].request, 'params'), false)
  })
}

test('loadWallet passes named parameters to the root endpoint and returns the full response', async (context) => {
  const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id }))
  const options = { walletName: 'Savings / é?#%' }
  const response = await new WasabiClient(credentials).loadWallet(options)
  assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id })
  assert.equal(calls[0].url, 'http://127.0.0.1:37128/')
  assert.equal(calls[0].request.method, 'loadwallet')
  assert.deepEqual(calls[0].request.params, options)
  assert.deepEqual(options, { walletName: 'Savings / é?#%' })
})

test('loadWallet passes positional parameters unchanged and wallet creates a separate encoded handle', async (context) => {
  const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, result: {} }))
  const params = ['Savings / é?#%']
  const client = new WasabiClient(credentials)
  const response = await client.loadWallet(params)
  assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result: {} })
  const wallet = client.wallet(params[0])
  assert.equal(wallet.walletName, params[0])
  assert.equal(calls[0].url, credentials.rpcUrl)
  assert.equal(calls[0].request.method, 'loadwallet')
  assert.deepEqual(calls[0].request.params, params)
  assert.deepEqual(params, ['Savings / é?#%'])
  await wallet.getWalletInfo()
  assert.equal(calls[1].url, 'http://127.0.0.1:37128/Savings%20%2F%20%C3%A9%3F%23%25')
})

test('wallet names are encoded as a single URL path segment', async (context) => {
  const calls = mockRpc(context)
  const wallet = new WasabiClient(credentials).wallet('Savings / é?#%+ &💰')
  await wallet.getWalletInfo()
  assert.equal(calls[0].url, 'http://127.0.0.1:37128/Savings%20%2F%20%C3%A9%3F%23%25%2B%20%26%F0%9F%92%B0')
})

test('a literal percent-encoded wallet name is encoded again rather than interpreted', async (context) => {
  const calls = mockRpc(context)
  await new WasabiClient(credentials).wallet('%2F').getWalletInfo()
  assert.equal(calls[0].url, 'http://127.0.0.1:37128/%252F')
})

for (const [options, expected] of [
  [{ rpcUrl: 'http://[::1]:40000/' }, 'http://[::1]:40000/'],
  [{ rpcUrl: 'http://localhost:40000' }, 'http://localhost:40000/'],
  [{ rpcUrl: 'https://rpc.example.test/proxy' }, 'https://rpc.example.test/proxy/'],
  [{ rpcUrl: 'http://localhost:40000/proxy///' }, 'http://localhost:40000/proxy/']
]) {
  test(`constructs root and wallet endpoints from ${JSON.stringify(options)}`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient({ ...credentials, ...options })
    await client.getStatus()
    await client.wallet('My Wallet').getWalletInfo()
    assert.equal(calls[0].url, expected)
    assert.equal(calls[1].url, `${expected}My%20Wallet`)
  })
}

test('uses UTF-8 Basic Auth and allows colons in the password', async (context) => {
  const calls = mockRpc(context)
  await new WasabiClient({ ...credentials, rpcUsername: 'usér', rpcPassword: 'päss:word' }).getStatus()
  const authorization = calls[0].options.headers.Authorization
  assert.equal(authorization, `Basic ${Buffer.from('usér:päss:word', 'utf8').toString('base64')}`)
  assert.equal(Buffer.from(authorization.slice(6), 'base64').toString('utf8'), 'usér:päss:word')
})

test('default request IDs are UUID strings unique across calls and clients', async (context) => {
  const calls = mockRpc(context)
  const client = new WasabiClient(credentials)
  await client.getStatus()
  await client.listWallets()
  await new WasabiClient(credentials).getStatus()
  const ids = calls.map((call) => call.request.id)
  assert.ok(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)))
  assert.equal(new Set(ids).size, ids.length)
})

test('returns history data unchanged without calculating CoinJoin fees', async (context) => {
  const history = [{ amount: -2110090, islikelycoinjoin: 'true', label: 'Transfer', extra: { raw: true } }]
  const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, result: history }))
  const response = await new WasabiClient(credentials).wallet('Wallet').getHistory()
  assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result: history })
})

for (const result of [null, false, 0, '', [], { balance: 123456 }]) {
  for (const rejectRpcErrors of [true, false]) {
    test(`preserves the full successful response with result ${JSON.stringify(result)} and rejectRpcErrors=${rejectRpcErrors}`, async (context) => {
      const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, result, extra: { future: true } }))
      const response = await new WasabiClient({ ...credentials, rejectRpcErrors }).getStatus()
      assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result, extra: { future: true } })
    })
  }
}

test('rejects JSON-RPC errors by default and preserves the complete original response', async (context) => {
  const rpcError = { code: -32603, message: 'Wallet is not loaded', data: { wallet: 'Wallet' }, future: ['raw'] }
  const calls = mockRpc(context, (request) => ({
    jsonrpc: '2.0',
    id: request.id,
    error: rpcError,
    extra: { future: true }
  }))

  await assert.rejects(new WasabiClient(credentials).getStatus(), (error) => {
    assert.ok(error instanceof WasabiRpcError)
    assert.ok(error instanceof WasabiError)
    assert.equal(error.name, 'WasabiRpcError')
    assert.equal(error.method, 'getstatus')
    assert.equal(error.code, -32603)
    assert.equal(error.message, 'Wallet is not loaded')
    assert.deepEqual(error.data, { wallet: 'Wallet' })
    assert.deepEqual(error.response, { jsonrpc: '2.0', id: calls[0].request.id, error: rpcError, extra: { future: true } })
    return true
  })
})

const parameterizedMethods = [
  ['client', 'createWallet', ['Savings', 'password']],
  ['client', 'recoverWallet', ['Savings', 'mnemonic', 'password']],
  ['client', 'broadcast', ['transaction-hex']],
  ['client', 'query', ['(+ 1 2)']],
  ['wallet', 'send', { payments: [{ sendto: 'address', amount: 12345 }], coins: [], feeTarget: 2 }],
  ['wallet', 'build', { payments: [{ sendto: 'address', amount: 12345 }], coins: [], feeRate: 1.5 }],
  ['wallet', 'buildUnsafeTransaction', { payments: [], coins: [], feeRate: 1000 }],
  ['wallet', 'speedUpTransaction', ['transaction-id', 'password']],
  ['wallet', 'cancelTransaction', ['transaction-id', 'password']],
  ['wallet', 'excludeFromCoinJoin', ['transaction-id', 0, true]],
  ['wallet', 'startCoinJoin', ['password', true, false]],
  ['wallet', 'payInCoinJoin', ['address', 12345]],
  ['wallet', 'cancelPaymentInCoinJoin', ['payment-id']],
  ['wallet', 'startCoinJoinSweep', ['password', 'Spending']]
]

const rpcCalls = [
  ['getStatus', (client, options) => client.getStatus(options)],
  ['listWallets', (client, options) => client.listWallets(options)],
  ['getFeeRates', (client, options) => client.getFeeRates(options)],
  ['loadWallet', (client, options) => client.loadWallet(['Savings'], options), 'loadwallet', ['Savings']],
  ['stop', (client, options) => client.stop(options)],
  ['getWalletInfo', (client, options) => client.wallet('Savings').getWalletInfo(options)],
  ['getHistory', (client, options) => client.wallet('Savings').getHistory(options)],
  ['listCoins', (client, options) => client.wallet('Savings').listCoins(options)],
  ['listUnspentCoins', (client, options) => client.wallet('Savings').listUnspentCoins(options)],
  ['listKeys', (client, options) => client.wallet('Savings').listKeys(options)],
  ['getNewAddress', (client, options) => client.wallet('Savings').getNewAddress(['Invoice', false], options), 'getnewaddress', ['Invoice', false]],
  ['listPaymentsInCoinJoin', (client, options) => client.wallet('Savings').listPaymentsInCoinJoin(options)],
  ['stopCoinJoin', (client, options) => client.wallet('Savings').stopCoinJoin(options)],
  ['client.call', (client, options) => client.call('futureRootMethod', { id: 'parameter-id' }, options), 'futureRootMethod', { id: 'parameter-id' }],
  ['wallet.call', (client, options) => client.wallet('Savings').call('futureWalletMethod', ['raw'], options), 'futureWalletMethod', ['raw']],
  ...parameterizedMethods.map(([target, method, params]) => [
    method,
    (client, options) => (target === 'client' ? client : client.wallet('Savings'))[method](params, options),
    method.toLowerCase(),
    params,
    target === 'client'
  ])
]

for (const [target, method] of parameterizedMethods) {
  test(`${method} forwards both parameter forms, preserves future fields and omits undefined params`, async (context) => {
    const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, extra: { raw: true } }))
    const client = new WasabiClient(credentials)
    const object = target === 'client' ? client : client.wallet('Savings')
    const values = [['raw', { future: true }], { id: 'parameter-id', future: { raw: true } }, undefined, null]
    for (const params of values) {
      const response = await object[method](params)
      const { request } = calls.at(-1)
      assert.deepEqual(request.params, params)
      assert.equal(Object.hasOwn(request, 'params'), params !== undefined)
      assert.deepEqual(response, { jsonrpc: '2.0', id: request.id, extra: { raw: true } })
    }
    assert.equal(calls.length, values.length)
  })
}

for (const target of ['client', 'wallet']) {
  for (const params of [undefined, null, [], {}, ['password', true], { payments: [{ amount: 12345 }], id: 'parameter-id' }]) {
    test(`${target}.call forwards ${JSON.stringify(params)} without interpreting parameters`, async (context) => {
      const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, result: null, extra: { raw: true } }))
      const client = new WasabiClient({ ...credentials, rpcUrl: 'https://rpc.example.test/prefix/' })
      const object = target === 'client' ? client : client.wallet('Savings / é?#%')
      const response = await object.call('FutureMethod', params)
      assert.deepEqual(calls[0].request.params, params)
      assert.equal(Object.hasOwn(calls[0].request, 'params'), params !== undefined)
      assert.equal(calls[0].request.method, 'FutureMethod')
      assert.equal(calls[0].url, target === 'client'
        ? 'https://rpc.example.test/prefix/'
        : 'https://rpc.example.test/prefix/Savings%20%2F%20%C3%A9%3F%23%25')
      assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result: null, extra: { raw: true } })
    })
  }

  test(`${target}.call omits parameters when given only a method name`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)
    const object = target === 'client' ? client : client.wallet('Savings')
    await object.call('stop')
    await object.call('stop', undefined, { id: 'stop-id' })
    assert.ok(calls.every(({ request }) => !Object.hasOwn(request, 'params')))
    assert.equal(calls[1].request.id, 'stop-id')
  })

  test(`${target}.call validates method names before dispatch`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)
    const object = target === 'client' ? client : client.wallet('Savings')
    for (const method of [undefined, null, '', '   ', 123, true, [], {}]) {
      await assert.rejects(object.call(method), { name: 'TypeError', message: 'method must be a non-empty string' })
    }
    assert.equal(calls.length, 0)
    await object.call('getstatus')
    assert.equal(calls.length, 1)
  })

  test(`${target}.call snapshots parameters before dispatch and recovers from serialization failures`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)
    const object = target === 'client' ? client : client.wallet('Savings')
    const params = { nested: [{ value: true }], id: 'parameter-id' }
    const options = { id: 'request-id' }
    const pending = object.call('build', params, options)
    params.nested[0].value = false
    options.id = 'changed'
    await pending
    assert.deepEqual(calls[0].request.params, { nested: [{ value: true }], id: 'parameter-id' })
    assert.equal(calls[0].request.id, 'request-id')

    const circular = {}
    circular.self = circular
    for (const invalidParams of [circular, [1n]]) {
      await assert.rejects(object.call('build', invalidParams), TypeError)
    }
    assert.equal(calls.length, 1)
    await client.getStatus()
    assert.equal(calls.length, 2)
  })
}

test('getNewAddress forwards named parameters unchanged and delegates validation to Wasabi', async (context) => {
  const calls = mockRpc(context)
  const wallet = new WasabiClient(credentials).wallet('Savings')
  await wallet.getNewAddress({ label: 'Invoice', isTaproot: true, future: { raw: true } })
  await wallet.getNewAddress(null)
  assert.deepEqual(calls[0].request.params, { label: 'Invoice', isTaproot: true, future: { raw: true } })
  assert.equal(calls[1].request.params, null)
  assert.ok(calls.every(({ request }) => request.method === 'getnewaddress'))
})

for (const [method, call, rpcMethod = method.toLowerCase(), params,
  rootMethod = ['getStatus', 'listWallets', 'getFeeRates', 'loadWallet', 'stop', 'client.call'].includes(method)] of rpcCalls) {
  test(`${method} sends an explicit request ID separately from RPC parameters`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)
    const options = { id: `custom-${method}` }
    const response = await call(client, options)
    const expectedRequest = { jsonrpc: '2.0', id: options.id, method: rpcMethod }

    if (params !== undefined) {
      expectedRequest.params = params
    }

    assert.deepEqual(calls[0].request, expectedRequest)
    assert.deepEqual(response, { jsonrpc: '2.0', id: options.id, result: {} })
    assert.deepEqual(options, { id: `custom-${method}` })
    assert.equal(calls[0].url, rootMethod ? credentials.rpcUrl : `${credentials.rpcUrl}Savings`)
    assert.equal(calls.length, 1)
  })

  for (const rejectRpcErrors of [true, false]) {
    test(`${method} respects rejectRpcErrors=${rejectRpcErrors} and preserves the server error response`, async (context) => {
      const rpcError = { code: -32603, message: 'Server message', data: { untouched: [1, 'raw'] }, future: true }
      const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, error: rpcError, extra: 'preserved' }))
      const client = new WasabiClient({ ...credentials, rejectRpcErrors })
      const id = `error-${method}`
      const pending = call(client, { id })

      if (rejectRpcErrors) {
        await assert.rejects(pending, (error) => {
          assert.ok(error instanceof WasabiRpcError)
          assert.equal(error.message, rpcError.message)
          assert.deepEqual(error.response, { jsonrpc: '2.0', id: calls[0].request.id, error: rpcError, extra: 'preserved' })
          return true
        })
      } else {
        const response = await pending
        assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, error: rpcError, extra: 'preserved' })
      }

      assert.equal(calls.length, 1)
      assert.equal(calls[0].request.method, rpcMethod)
      assert.equal(calls[0].request.id, id)
    })
  }
}

test('omitted IDs generate distinct UUIDs when options are empty or id is undefined', async (context) => {
  const calls = mockRpc(context)
  const client = new WasabiClient(credentials)
  await client.getStatus({})
  await client.loadWallet(['Savings'], { id: undefined })
  await client.wallet('Savings').getHistory({})
  const ids = calls.map(({ request }) => request.id)
  assert.ok(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)))
  assert.equal(new Set(ids).size, ids.length)
})

test('caller-supplied string IDs are preserved exactly', async (context) => {
  const calls = mockRpc(context)
  const id = '  trace / é💰?#  '
  const response = await new WasabiClient(credentials).getStatus({ id })
  assert.equal(calls[0].request.id, id)
  assert.equal(response.id, id)
})

test('loadWallet keeps a params object id separate from the request ID', async (context) => {
  const calls = mockRpc(context)
  const params = { walletName: 'Savings', id: 'method-parameter', future: { untouched: true } }
  const response = await new WasabiClient(credentials).loadWallet(params, { id: 'request-id' })
  assert.deepEqual(calls[0].request.params, params)
  assert.equal(calls[0].request.id, 'request-id')
  assert.deepEqual(response, { jsonrpc: '2.0', id: 'request-id', result: {} })
})

for (const id of [null, '', '   ', 0, 2, 1.5, NaN, Infinity, true, [], {}, 2n]) {
  test(`rejects invalid request ID ${String(id)} (${typeof id}) without sending a request`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)
    await assert.rejects(client.getStatus({ id }), { name: 'TypeError', message: 'id must be a non-empty string' })
    assert.equal(calls.length, 0)
    await client.getStatus({ id: 'valid-after-rejection' })
    assert.equal(calls.length, 1)
  })
}

for (const options of [null, '2', 2, true, [], [{ id: '2' }]]) {
  test(`all RPC methods reject invalid options ${JSON.stringify(options)} without sending requests`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)

    for (const [, call] of rpcCalls) {
      await assert.rejects(call(client, options), TypeError)
    }

    assert.equal(calls.length, 0)
  })
}

test('all RPC methods reject an invalid ID in their request options', async (context) => {
  const calls = mockRpc(context)
  const client = new WasabiClient(credentials)

  for (const [, call] of rpcCalls) {
    await assert.rejects(call(client, { id: null }), TypeError)
  }

  assert.equal(calls.length, 0)
})

for (const rejectRpcErrors of [true, false]) {
  test(`a mismatched custom response ID rejects before handling RPC errors with rejectRpcErrors=${rejectRpcErrors}`, async (context) => {
    mockRpc(context, () => ({ jsonrpc: '2.0', id: 'different', error: { code: -32603, message: 'Server message' } }))
    const client = new WasabiClient({ ...credentials, rejectRpcErrors })
    await assert.rejects(client.wallet('Savings').getHistory({ id: 'history-1' }), WasabiResponseError)
  })
}

test('response ID matching preserves the string type of a caller-supplied ID', async (context) => {
  mockRpc(context, () => ({ jsonrpc: '2.0', id: 2, result: {} }))
  await assert.rejects(new WasabiClient(credentials).getStatus({ id: '2' }), WasabiResponseError)
})

test('queued requests snapshot options and keep independent IDs across wallet handles', async (context) => {
  let releaseFirst
  const gate = new Promise((resolve) => { releaseFirst = resolve })
  const calls = mockRpc(context, async (request) => {
    if (request.method === 'getstatus') {
      await gate
    }

    return { jsonrpc: '2.0', id: request.id, result: {} }
  })
  const client = new WasabiClient(credentials)
  const first = client.getStatus({ id: 'first' })
  const options = { id: 'savings' }
  const second = client.wallet('Savings').getHistory(options)
  const third = client.wallet('Spending').listCoins({ id: 'spending' })
  options.id = 'changed-before-dispatch'
  await setImmediate()
  assert.equal(calls.length, 1)
  releaseFirst()
  const responses = await Promise.all([first, second, third])
  assert.deepEqual(responses.map((response) => response.id), ['first', 'savings', 'spending'])
  assert.deepEqual(calls.map(({ request }) => request.id), ['first', 'savings', 'spending'])
  assert.deepEqual(calls.map(({ url }) => url), [credentials.rpcUrl, `${credentials.rpcUrl}Savings`, `${credentials.rpcUrl}Spending`])
})

for (const rejectRpcErrors of [true, false]) {
  test(`preserves responses without result for root and wallet methods with rejectRpcErrors=${rejectRpcErrors}`, async (context) => {
    const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, extra: { untouched: true } }))
    const client = new WasabiClient({ ...credentials, rejectRpcErrors })
    const responses = await Promise.all([client.getStatus(), client.wallet('Savings').getWalletInfo()])
    assert.deepEqual(responses, calls.map(({ request }) => ({ jsonrpc: '2.0', id: request.id, extra: { untouched: true } })))
  })
}

test('returning an RPC error normally still allows the next queued request to run', async (context) => {
  const calls = mockRpc(context, (request) => request.method === 'getstatus'
    ? { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Failed' } }
    : { jsonrpc: '2.0', id: request.id, result: [] })
  const client = new WasabiClient({ ...credentials, rejectRpcErrors: false })
  const responses = await Promise.all([client.getStatus(), client.listWallets()])
  assert.deepEqual(responses, [
    { jsonrpc: '2.0', id: calls[0].request.id, error: { code: -32603, message: 'Failed' } },
    { jsonrpc: '2.0', id: calls[1].request.id, result: [] }
  ])
})

for (const [label, reply, errorClass] of [
  ['HTTP error', () => new Response('Unauthorized', { status: 401 }), WasabiHttpError],
  ['non-JSON response', () => new Response('not JSON'), WasabiResponseError],
  ['mismatched ID', () => ({ jsonrpc: '2.0', id: 'wrong', result: {} }), WasabiResponseError],
  ['malformed RPC error', (request) => ({ jsonrpc: '2.0', id: request.id, error: null }), WasabiResponseError],
  ['connection failure', () => { throw new TypeError('fetch failed') }, WasabiTransportError]
]) {
  test(`${label} still rejects when rejectRpcErrors=false`, async (context) => {
    mockRpc(context, reply)
    await assert.rejects(new WasabiClient({ ...credentials, rejectRpcErrors: false }).getStatus(), errorClass)
  })
}

for (const status of [302, 401, 500]) {
  test(`exposes HTTP ${status} errors even when the body is not JSON`, async (context) => {
    mockRpc(context, () => new Response('HTTP failure body', { status, statusText: 'Failure' }))

    await assert.rejects(new WasabiClient(credentials).getStatus(), (error) => {
      assert.ok(error instanceof WasabiHttpError)
      assert.equal(error.status, status)
      assert.equal(error.statusText, 'Failure')
      assert.equal(error.body, 'HTTP failure body')
      assert.equal(error.method, 'getstatus')
      return true
    })
  })
}

for (const body of ['', '<html>Not JSON</html>', '{"jsonrpc":']) {
  test(`rejects non-JSON response ${JSON.stringify(body)}`, async (context) => {
    mockRpc(context, () => new Response(body))

    await assert.rejects(new WasabiClient(credentials).getStatus(), (error) => {
      assert.ok(error instanceof WasabiResponseError)
      assert.ok(error.cause instanceof SyntaxError)
      return true
    })
  })
}

for (const [label, reply] of [
  ['null', () => null],
  ['primitive', () => 5],
  ['batch', (request) => [{ jsonrpc: '2.0', id: request.id, result: {} }]],
  ['wrong version', (request) => ({ jsonrpc: '1.0', id: request.id, result: {} })],
  ['missing version', (request) => ({ id: request.id, result: {} })],
  ['wrong ID', () => ({ jsonrpc: '2.0', id: 'wrong', result: {} })],
  ['missing ID', () => ({ jsonrpc: '2.0', result: {} })],
  ['null error', (request) => ({ jsonrpc: '2.0', id: request.id, error: null })],
  ['invalid error code', (request) => ({ jsonrpc: '2.0', id: request.id, error: { code: 'bad', message: 'Bad' } })],
  ['missing error message', (request) => ({ jsonrpc: '2.0', id: request.id, error: { code: -32603 } })],
  ['result and error', (request) => ({ jsonrpc: '2.0', id: request.id, result: {}, error: { code: -32603, message: 'Bad' } })]
]) {
  test(`rejects malformed JSON-RPC envelope: ${label}`, async (context) => {
    mockRpc(context, reply)
    await assert.rejects(new WasabiClient(credentials).getStatus(), WasabiResponseError)
  })
}

test('preserves the cause of a network error', async (context) => {
  const cause = new TypeError('fetch failed')
  mockRpc(context, () => { throw cause })

  await assert.rejects(new WasabiClient(credentials).getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.equal(error.cause, cause)
    assert.match(error.message, /getstatus/u)
    return true
  })
})

test('reports failures while reading the response body', async (context) => {
  const cause = new Error('Connection closed')
  mockRpc(context, () => new Response(new ReadableStream({
    start(controller) {
      controller.error(cause)
    }
  })))

  await assert.rejects(new WasabiClient(credentials).getStatus(), (error) => {
    assert.ok(error instanceof WasabiTransportError)
    assert.equal(error.cause, cause)
    return true
  })
})

test('serializes concurrent calls until the preceding response body is consumed', async (context) => {
  let controller
  let firstRequest
  const calls = mockRpc(context, (request) => {
    if (request.method === 'loadwallet') {
      firstRequest = request
      return new Response(new ReadableStream({
        start(streamController) {
          controller = streamController
        }
      }))
    }

    return { jsonrpc: '2.0', id: request.id, result: { walletName: 'Wallet' } }
  })

  const client = new WasabiClient(credentials)
  const loading = client.loadWallet({ walletName: 'Savings' })
  const info = client.wallet('Spending').call('getwalletinfo')
  const status = client.call('getstatus')
  const coins = client.wallet('Savings').listCoins()
  await setImmediate()
  assert.equal(calls.length, 1)
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: firstRequest.id })))
  controller.close()
  assert.deepEqual(await loading, { jsonrpc: '2.0', id: firstRequest.id })
  assert.deepEqual(await info, { jsonrpc: '2.0', id: calls[1].request.id, result: { walletName: 'Wallet' } })
  await Promise.all([status, coins])
  assert.deepEqual(calls.map((call) => call.request.method), ['loadwallet', 'getwalletinfo', 'getstatus', 'listcoins'])
  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:37128/',
    'http://127.0.0.1:37128/Spending',
    'http://127.0.0.1:37128/',
    'http://127.0.0.1:37128/Savings'
  ])
})

test('a failed call rejects its caller and does not poison the queue', async (context) => {
  const calls = mockRpc(context, (request) => request.method === 'getstatus'
    ? { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Failed' } }
    : { jsonrpc: '2.0', id: request.id, result: [] })
  const client = new WasabiClient(credentials)
  const results = await Promise.allSettled([client.getStatus(), client.listWallets()])
  assert.equal(results[0].status, 'rejected')
  assert.ok(results[0].reason instanceof WasabiRpcError)
  assert.deepEqual(results[1], { status: 'fulfilled', value: { jsonrpc: '2.0', id: calls[1].request.id, result: [] } })
  assert.equal(calls.length, 2)
})

test('wallet accepts a single name without loading or querying Wasabi', async (context) => {
  const calls = mockRpc(context)
  const client = new WasabiClient(credentials)
  const wallet = client.wallet('Savings / é?#%')
  assert.equal(wallet.walletName, 'Savings / é?#%')
  assert.equal(calls.length, 0)
  assert.equal(typeof wallet.then, 'undefined')
  await wallet.getWalletInfo()
  assert.equal(calls[0].request.method, 'getwalletinfo')
  assert.equal(calls[0].url, 'http://127.0.0.1:37128/Savings%20%2F%20%C3%A9%3F%23%25')
})

test('wallet names remain fixed when the caller reassigns its name variable', async (context) => {
  const calls = mockRpc(context)
  const client = new WasabiClient(credentials)
  let walletName = 'Savings'
  const wallet = client.wallet(walletName)
  walletName = 'Spending'

  assert.throws(() => { wallet.walletName = walletName }, TypeError)
  await wallet.getWalletInfo()
  assert.equal(wallet.walletName, 'Savings')
  assert.equal(calls[0].url, 'http://127.0.0.1:37128/Savings')
})

test('different wallets route independently through the same client', async (context) => {
  const calls = mockRpc(context)
  const client = new WasabiClient(credentials)
  const savings = client.wallet('Savings')
  const spending = client.wallet('Spending')
  await Promise.all([savings.getHistory(), spending.listCoins(), savings.listUnspentCoins(), client.getStatus()])
  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:37128/Savings',
    'http://127.0.0.1:37128/Spending',
    'http://127.0.0.1:37128/Savings',
    'http://127.0.0.1:37128/'
  ])
})

test('loadWallet preserves additional named parameters and snapshots them before dispatch', async (context) => {
  const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id }))
  const options = { walletName: 'Savings', futureOption: { value: true } }
  const loading = new WasabiClient(credentials).loadWallet(options)
  options.walletName = 'Spending'
  options.futureOption.value = false
  assert.deepEqual(await loading, { jsonrpc: '2.0', id: calls[0].request.id })
  assert.deepEqual(calls[0].request.params, { walletName: 'Savings', futureOption: { value: true } })
})

test('loadWallet preserves additional positional parameters and snapshots them before dispatch', async (context) => {
  const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id }))
  const params = ['Savings', { futureOption: true }]
  const loading = new WasabiClient(credentials).loadWallet(params)
  params[0] = 'Spending'
  params[1].futureOption = false
  params.push('another value')
  assert.deepEqual(await loading, { jsonrpc: '2.0', id: calls[0].request.id })
  assert.deepEqual(calls[0].request.params, ['Savings', { futureOption: true }])
})

for (const params of [undefined, null, [], {}, [''], { walletName: '' }, ['..']]) {
  for (const rejectRpcErrors of [true, false]) {
    test(`loadWallet delegates parameter validation to Wasabi for ${JSON.stringify(params)} with rejectRpcErrors=${rejectRpcErrors}`, async (context) => {
      const rpcError = { code: -32602, message: 'Invalid params', data: { from: 'server' } }
      const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, error: rpcError }))
      const client = new WasabiClient({ ...credentials, rejectRpcErrors })
      const pending = client.loadWallet(params)

      if (rejectRpcErrors) {
        await assert.rejects(pending, (error) => {
          assert.ok(error instanceof WasabiRpcError)
          assert.deepEqual(error.response, { jsonrpc: '2.0', id: calls[0].request.id, error: rpcError })
          return true
        })
      } else {
        const response = await pending
        assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, error: rpcError })
      }

      assert.equal(calls.length, 1)
      assert.deepEqual(calls[0].request.params, params)
      assert.equal(Object.hasOwn(calls[0].request, 'params'), params !== undefined)
    })
  }
}

for (const result of [null, {}]) {
  test(`loadWallet preserves the full response when Wasabi supplies result ${JSON.stringify(result)}`, async (context) => {
    const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, result }))
    const response = await new WasabiClient(credentials).loadWallet({ walletName: 'Savings' })
    assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result })
    assert.equal(calls.length, 1)
  })
}

test('loadWallet rejects RPC failures and another wallet can still be queried', async (context) => {
  const calls = mockRpc(context, (request) => request.method === 'loadwallet'
    ? { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Wallet not found' } }
    : { jsonrpc: '2.0', id: request.id, result: { loaded: true } })
  const client = new WasabiClient(credentials)
  await assert.rejects(client.loadWallet({ walletName: 'Missing' }), WasabiRpcError)
  const response = await client.wallet('Savings').getWalletInfo()
  assert.deepEqual(response, { jsonrpc: '2.0', id: calls[1].request.id, result: { loaded: true } })
})

test('a local handle forwards server responses before and after a separate loadWallet call', async (context) => {
  const loaded = new Set()
  const calls = mockRpc(context, (request) => {
    if (request.method === 'loadwallet') {
      loaded.add(request.params[0])
      return { jsonrpc: '2.0', id: request.id }
    }

    return loaded.has('Savings')
      ? { jsonrpc: '2.0', id: request.id, result: [] }
      : { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'There is no wallet loaded' } }
  })
  const client = new WasabiClient(credentials)
  const params = ['Savings']
  const wallet = client.wallet('Savings')
  await assert.rejects(wallet.getHistory(), WasabiRpcError)
  assert.deepEqual(await client.loadWallet(params), { jsonrpc: '2.0', id: calls[1].request.id })
  const response = await wallet.getHistory()
  assert.deepEqual(response, { jsonrpc: '2.0', id: calls[2].request.id, result: [] })
})

test('getWalletInfo preserves unloaded metadata without enforcing readiness locally', async (context) => {
  const calls = mockRpc(context, (request) => ({ jsonrpc: '2.0', id: request.id, result: { walletName: 'Savings', loaded: false } }))
  const wallet = new WasabiClient(credentials).wallet('Savings')
  const response = await wallet.getWalletInfo()
  assert.deepEqual(response, { jsonrpc: '2.0', id: calls[0].request.id, result: { walletName: 'Savings', loaded: false } })
})

for (const walletName of [undefined, null, '', '   ', '.', '..', '\uD800', 123, [], ['Savings'], ['Savings', 'Spending'], {}, { walletName: 'Savings' }]) {
  test(`rejects invalid wallet name: ${JSON.stringify(walletName)}`, (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)
    assert.throws(() => client.wallet(walletName), TypeError)
    assert.equal(calls.length, 0)
  })
}

for (const params of [{ walletName: 'Savings' }, ['Savings']]) {
  test(`loadWallet rejects unserializable ${Array.isArray(params) ? 'array' : 'object'} parameters before sending a request`, async (context) => {
    const calls = mockRpc(context)
    const client = new WasabiClient(credentials)

    if (Array.isArray(params)) {
      params.push(params)
    } else {
      params.circular = params
    }

    await assert.rejects(client.loadWallet(params), TypeError)
    assert.equal(calls.length, 0)
    await client.getStatus()
    assert.equal(calls.length, 1)
  })
}

test('the public interfaces do not expose the low-level transport', () => {
  const client = new WasabiClient(credentials)
  const wallet = client.wallet('Savings')

  for (const object of [client, wallet]) {
    assert.equal(typeof object.call, 'function')
    assert.equal(object.request, undefined)
    assert.equal(object.rpc, undefined)
  }

  assert.equal(client.send, undefined)
  assert.equal(typeof wallet.send, 'function')
  assert.equal(client.getWalletInfo, undefined)
  assert.equal(wallet.getStatus, undefined)
  assert.equal(client.close, undefined)
})

for (const [label, options] of [
  ['missing URL', { rpcUrl: undefined }],
  ['null URL', { rpcUrl: null }],
  ['empty URL', { rpcUrl: '' }],
  ['missing username', { rpcUsername: undefined }],
  ['missing password', { rpcPassword: undefined }],
  ['empty username', { rpcUsername: '' }],
  ['empty password', { rpcPassword: '' }],
  ['colon in username', { rpcUsername: 'user:name' }],
  ['constructor wallet name', { walletName: 'Wallet' }],
  ['removed host option', { host: 'localhost' }],
  ['removed port option', { port: 40000 }],
  ['unsupported protocol', { rpcUrl: 'file:///tmp/rpc' }],
  ['embedded credentials', { rpcUrl: 'http://user:pass@localhost/' }],
  ['query', { rpcUrl: 'http://localhost/?wallet=Wallet' }],
  ['fragment', { rpcUrl: 'http://localhost/#Wallet' }],
  ['invalid URL', { rpcUrl: 'not a URL' }],
  ['invalid URL port', { rpcUrl: 'http://localhost:65536/' }],
  ['zero timeout', { timeoutMs: 0 }],
  ['fractional timeout', { timeoutMs: 1.5 }],
  ['large timeout', { timeoutMs: 2147483648 }],
  ['null RPC error policy', { rejectRpcErrors: null }],
  ['string RPC error policy', { rejectRpcErrors: 'false' }],
  ['numeric RPC error policy', { rejectRpcErrors: 0 }],
  ['object RPC error policy', { rejectRpcErrors: {} }],
  ['null dispatcher', { dispatcher: null }],
  ['string dispatcher', { dispatcher: 'agent' }],
  ['numeric dispatcher', { dispatcher: 1 }],
  ['boolean dispatcher', { dispatcher: false }],
  ['array dispatcher', { dispatcher: [] }],
  ['dispatcher without dispatch', { dispatcher: {} }],
  ['non-function dispatch', { dispatcher: { dispatch: true } }],
  ['dispatcher with proxy', { dispatcher: { dispatch() {} }, proxyUrl: 'socks5h://127.0.0.1:9050' }]
]) {
  test(`rejects configuration: ${label}`, () => {
    assert.throws(() => new WasabiClient({ ...credentials, ...options }), TypeError)
  })
}

test('rpcUrl is required and omission does not select a default endpoint', () => {
  assert.throws(() => new WasabiClient({ rpcUsername: 'rpc-user', rpcPassword: 'rpc-password' }), {
    name: 'TypeError',
    message: 'rpcUrl must be a non-empty string'
  })
})

test('native fetch sends authentication and encoded paths to an HTTP server', async (context) => {
  const calls = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      calls.push({ url: request.url, method: request.method, headers: request.headers, payload })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { amount: 12345 } }))
    })
  })

  context.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const client = new WasabiClient({ ...credentials, rpcUrl: `http://127.0.0.1:${server.address().port}/` })
  const status = await client.getStatus()
  const coins = await client.wallet('Savings é?#').listUnspentCoins()
  assert.deepEqual(status, { jsonrpc: '2.0', id: calls[0].payload.id, result: { amount: 12345 } })
  assert.deepEqual(coins, { jsonrpc: '2.0', id: calls[1].payload.id, result: { amount: 12345 } })
  assert.deepEqual(calls.map((call) => call.url), ['/', '/Savings%20%C3%A9%3F%23'])
  assert.ok(calls.every((call) => call.method === 'POST'))
  assert.ok(calls.every((call) => call.headers.authorization === `Basic ${Buffer.from('rpc-user:rpc-password').toString('base64')}`))
})

test('request timeouts reject and allow the next queued call to run', async (context) => {
  const calls = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      calls.push(payload)

      if (payload.method === 'listwallets') {
        response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: [] }))
      }
    })
  })

  context.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const client = new WasabiClient({ ...credentials, rpcUrl: `http://127.0.0.1:${server.address().port}/`, timeoutMs: 200, rejectRpcErrors: false })
  const results = await Promise.allSettled([client.getStatus(), client.listWallets()])
  assert.equal(results[0].status, 'rejected')
  assert.ok(results[0].reason instanceof WasabiTransportError)
  assert.equal(results[0].reason.cause.name, 'TimeoutError')
  assert.deepEqual(results[1], { status: 'fulfilled', value: { jsonrpc: '2.0', id: calls[1].id, result: [] } })
})
