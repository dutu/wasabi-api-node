import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { requireWalletName, requireOptions, requireString } from './options.js'
import { WasabiWallet } from './wasabi-wallet.js'
import { createProxyDispatcherFactory } from './proxy.js'
import {
  WasabiTransportError,
  WasabiHttpError,
  WasabiResponseError,
  WasabiRpcError
} from './errors.js'

const createRpcUrl = function createRpcUrl(rpcUrl) {
  requireString(rpcUrl, 'rpcUrl')
  const url = new URL(rpcUrl)

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('rpcUrl must use HTTP or HTTPS')
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('rpcUrl cannot contain credentials, a query or a fragment')
  }

  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`
  return url.href
}

/** A Wasabi Wallet client using native fetch. Connection settings are immutable. */
export class WasabiClient {
  #rpcUrl
  #authorization
  #timeoutMs
  #rejectRpcErrors
  #createDispatcher
  #queue = Promise.resolve()

  /**
   * @param {object} options
   * @param {string} options.rpcUsername Wasabi's JsonRpcUser
   * @param {string} options.rpcPassword Wasabi's JsonRpcPassword
   * @param {string} options.rpcUrl Root HTTP(S) RPC URL
   * @param {string} [options.proxyUrl] SOCKS5 proxy URL, with destination DNS resolved by the proxy
   * @param {number} [options.timeoutMs=30000] Timeout per dispatched request
   * @param {boolean} [options.rejectRpcErrors=true] Reject JSON-RPC errors while preserving their response
   */
  constructor(options = {}) {
    requireOptions(options)

    if (Object.hasOwn(options, 'host') || Object.hasOwn(options, 'port')) {
      throw new TypeError('Use rpcUrl to configure the host and port')
    }

    if (Object.hasOwn(options, 'walletName')) {
      throw new TypeError('Pass the wallet name to wallet(walletName) or loadWallet([walletName])')
    }

    const { rpcUrl, rpcUsername, rpcPassword, proxyUrl, timeoutMs = 30000, rejectRpcErrors = true } = options
    this.#rpcUrl = createRpcUrl(rpcUrl)
    requireString(rpcUsername, 'rpcUsername')
    requireString(rpcPassword, 'rpcPassword')

    if (rpcUsername.includes(':')) {
      throw new TypeError('rpcUsername cannot contain a colon in HTTP Basic Authentication')
    }

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
      throw new TypeError('timeoutMs must be an integer between 1 and 2147483647')
    }

    if (typeof rejectRpcErrors !== 'boolean') {
      throw new TypeError('rejectRpcErrors must be a boolean')
    }

    this.#authorization = `Basic ${Buffer.from(`${rpcUsername}:${rpcPassword}`, 'utf8').toString('base64')}`
    this.#timeoutMs = timeoutMs
    this.#rejectRpcErrors = rejectRpcErrors
    this.#createDispatcher = createProxyDispatcherFactory(proxyUrl, timeoutMs)
  }

  getStatus(options) {
    return this.#request('getstatus', options)
  }

  listWallets(options) {
    return this.#request('listwallets', options)
  }

  /**
   * Create a wallet handle without making an RPC request or checking its state.
   * @param {string} walletName Name of the single wallet represented by the handle
   */
  wallet(walletName) {
    requireWalletName(walletName)
    return new WasabiWallet(walletName, (method, options) => this.#request(method, options, { walletName }))
  }

  /**
   * Forward loading parameters and return the JSON-RPC response.
   * @param {object|Array<*>} params Wasabi's loadwallet params value
   * @param {object} [options] Request options
   * @param {string} [options.id] Request ID; defaults to a generated UUID
   */
  loadWallet(params, options) {
    return this.#request('loadwallet', options, { params })
  }

  getFeeRates(options) {
    return this.#request('getfeerates', options)
  }

  async #request(method, options = {}, { walletName, params } = {}) {
    requireOptions(options)
    const id = options.id === undefined ? randomUUID() : requireString(options.id, 'id')

    const endpoint = walletName !== undefined
      ? `${this.#rpcUrl}${encodeURIComponent(walletName)}`
      : this.#rpcUrl

    const request = { jsonrpc: '2.0', id, method }

    if (params !== undefined) {
      request.params = params
    }

    const body = JSON.stringify(request)
    const pending = this.#queue.then(() => this.#send(endpoint, request, body))

    // Advance the queue after either outcome. The caller still receives the rejection.
    this.#queue = pending.then(() => undefined, () => undefined)
    return pending
  }

  async #send(endpoint, request, requestBody) {
    const dispatcher = this.#createDispatcher?.()
    let response
    let body
    let failure

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: this.#authorization
        },
        body: requestBody,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#timeoutMs),
        ...(dispatcher === undefined ? {} : { dispatcher })
      })
      body = await response.text()
    } catch (cause) {
      failure = cause
    } finally {
      try {
        await dispatcher?.destroy()
      } catch (cause) {
        failure = failure === undefined
          ? cause
          : new AggregateError([failure, cause], 'Request and proxy cleanup failed')
      }
    }

    if (failure !== undefined) {
      throw new WasabiTransportError(`Wasabi ${request.method} request failed: ${failure.message}`, { cause: failure })
    }

    if (!response.ok) {
      throw new WasabiHttpError(request.method, response, body)
    }

    let payload

    try {
      payload = JSON.parse(body)
    } catch (cause) {
      throw new WasabiResponseError(`Wasabi ${request.method} returned invalid JSON`, { cause })
    }

    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
      || payload.jsonrpc !== '2.0' || payload.id !== request.id) {
      throw new WasabiResponseError(`Wasabi ${request.method} returned an invalid JSON-RPC envelope or mismatched ID`)
    }

    const hasResult = Object.hasOwn(payload, 'result')
    const hasError = Object.hasOwn(payload, 'error')

    if (hasError) {
      const error = payload.error

      if (hasResult || error === null || typeof error !== 'object' || Array.isArray(error)
        || !Number.isInteger(error.code) || typeof error.message !== 'string') {
        throw new WasabiResponseError(`Wasabi ${request.method} returned an invalid JSON-RPC error`)
      }

      if (this.#rejectRpcErrors) {
        throw new WasabiRpcError(request.method, payload)
      }
    }

    return payload
  }
}
