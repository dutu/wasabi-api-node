import assert from 'node:assert/strict'
import test from 'node:test'
import { WasabiClient, WasabiHttpError, WasabiRpcError } from 'wasabi-api-node'

const assertEnvelope = function assertEnvelope(response, id) {
  assert.equal(response.jsonrpc, '2.0')
  assert.equal(response.id, id)
}

const assertMethodNotFound = function assertMethodNotFound(response, id) {
  assertEnvelope(response, id)
  assert.equal(Object.hasOwn(response, 'result'), false)
  assert.equal(response.error.code, -32601)
  assert.equal(typeof response.error.message, 'string')
  assert.ok(response.error.message.length > 0)
}

test('live Wasabi RPC integration', {
  skip: process.env.WASABI_RPC_URL === undefined && 'Set WASABI_RPC_URL to run live integration tests',
  timeout: 60000
}, async (context) => {
  for (const name of ['WASABI_RPC_USERNAME', 'WASABI_RPC_PASSWORD']) {
    assert.ok(process.env[name], `${name} must be set when WASABI_RPC_URL is set`)
  }

  const options = {
    rpcUrl: process.env.WASABI_RPC_URL,
    rpcUsername: process.env.WASABI_RPC_USERNAME,
    rpcPassword: process.env.WASABI_RPC_PASSWORD,
    timeoutMs: 10000
  }
  const client = new WasabiClient(options)
  // An unknown method produces a real RPC error without changing wallet state.
  const unknownMethod = 'wasabi-api-node-live-test-unknown-method'
  const errorId = 'live-method-not-found'
  let errorResponse

  await context.test('accepts valid Basic Auth and returns a success envelope with the requested ID', async () => {
    const id = 'live-getstatus'
    const response = await client.getStatus({ id })
    assertEnvelope(response, id)
    assert.equal(Object.hasOwn(response, 'error'), false)
    assert.ok(response.result !== null && typeof response.result === 'object')
    assert.equal(Array.isArray(response.result), false)
  })

  await context.test('rejects an incorrect Basic Auth password with HTTP 401', async () => {
    const unauthorized = new WasabiClient({
      ...options,
      rpcPassword: `${options.rpcPassword}-incorrect-live-test-password`
    })
    await assert.rejects(unauthorized.getStatus(), (error) => {
      assert.ok(error instanceof WasabiHttpError)
      assert.equal(error.status, 401)
      assert.equal(error.method, 'getstatus')
      assert.equal(typeof error.body, 'string')
      return true
    })
  })

  await context.test('returns the real method-not-found payload when rejectRpcErrors is false', async () => {
    const returning = new WasabiClient({ ...options, rejectRpcErrors: false })
    errorResponse = await returning.call(unknownMethod, undefined, { id: errorId })
    assertMethodNotFound(errorResponse, errorId)
  })

  await context.test('throws WasabiRpcError and preserves the complete method-not-found payload by default', async () => {
    await assert.rejects(client.call(unknownMethod, undefined, { id: errorId }), (error) => {
      assert.ok(error instanceof WasabiRpcError)
      assertMethodNotFound(error.response, errorId)
      assert.equal(error.method, unknownMethod)
      assert.equal(error.code, error.response.error.code)
      assert.equal(error.message, error.response.error.message)
      assert.deepEqual(error.data, error.response.error.data)
      assert.deepEqual(error.response, errorResponse)
      return true
    })
  })
})
