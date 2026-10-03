# wasabi-api-node

[![CI](https://github.com/dutu/wasabi-api-node/actions/workflows/ci.yml/badge.svg)](https://github.com/dutu/wasabi-api-node/actions/workflows/ci.yml)

A small Node.js client for the Wasabi Wallet JSON-RPC API. Requires
**Node.js >= 22**.

Supports HTTP and HTTPS RPC connections, optionally through a SOCKS5 proxy.

The library is intentionally thin: RPC responses are returned in their original
JSON-RPC form and Wasabi-specific accounting or business logic is not added.

For server setup, RPC parameters and response definitions, see the
[official Wasabi RPC documentation](https://docs.wasabiwallet.io/using-wasabi/RPC.html).

## Usage

```js
import { WasabiClient } from 'wasabi-api-node'

const client = new WasabiClient({
  rpcUrl: process.env.WASABI_RPC_URL,
  rpcUsername: process.env.WASABI_RPC_USERNAME,
  rpcPassword: process.env.WASABI_RPC_PASSWORD
})

await client.loadWallet(['My Wallet'])

const wallet = client.wallet('My Wallet')

const walletInfo = await wallet.getWalletInfo()
const history = await wallet.getHistory()
const unspentCoins = await wallet.listUnspentCoins()

console.log(walletInfo.result, history.result, unspentCoins.result)
```

## TypeScript

TypeScript declarations are included. See the [TypeScript guide](./docs/typescript.md)
for typed results, error handling and exported types.

## Connection options

Pass these settings to `new WasabiClient({ ... })`:

| Option | Default | Description |
| --- | --- | --- |
| `rpcUrl` | No default | Required root HTTP or HTTPS URL, including any port or reverse-proxy prefix, e.g. `http://127.0.0.1:37128/` or `https://rpc.example.com/wasabi/`. URL credentials, query strings and fragments are rejected. |
| `rpcUsername` | No default | Required non-empty HTTP Basic Auth username. Cannot contain `:`. |
| `rpcPassword` | No default | Required non-empty HTTP Basic Auth password. |
| `proxyUrl` | None | Optional SOCKS5 proxy URL with an explicit port, e.g. `socks5h://127.0.0.1:9050`. See the [proxy guide](./docs/proxy.md) for Tor setup, authentication and connection pooling. |
| `proxyPooling` | `false` | Reuse the client's SOCKS5 connections across requests. Requires `proxyUrl`. Release the pool with `await client.close()`. |
| `dispatcher` | None | Optional caller-owned Undici-compatible dispatcher for custom TLS or transport settings. Must have a `dispatch()` method. Cannot be combined with `proxyUrl`; configure any proxying in the dispatcher instead. See [Custom TLS and dispatchers](./docs/tls.md). |
| `timeoutMs` | `30000` | Positive integer timeout in milliseconds covering connection setup and reading the response. The timeout starts when the request is sent. |
| `rejectRpcErrors` | `true` | When `true`, RPC methods throw `WasabiRpcError` for JSON-RPC error responses. When `false`, the complete JSON-RPC error response is returned instead. See [Errors](#errors). |

## Implemented RPC methods

Root-level RPC methods are exposed directly by `WasabiClient`.

Wallet-specific RPC methods are accessed through `client.wallet('Wallet name')`.

One client can access multiple wallets. Calling `wallet()` makes no RPC request,
does not verify that the wallet exists, and does not load the wallet. Use
`loadWallet()` separately when required.

Wallet names are encoded automatically when constructing request URLs. Wallet
names must be non-empty strings and cannot be `.` or `..`.

| Object | Method | Wasabi RPC method |
| --- | --- | --- |
| Client | `getStatus(options)` | `getstatus` |
| Client | `listWallets(options)` | `listwallets` |
| Client | `getFeeRates(options)` | `getfeerates` |
| Client | `loadWallet(params, options)` | `loadwallet` |
| Client | `createWallet(params, options)` | `createwallet` |
| Client | `recoverWallet(params, options)` | `recoverwallet` |
| Client | `broadcast(params, options)` | `broadcast` |
| Client | `query(params, options)` | `query` |
| Client | `stop(options)` | `stop` |
| Wallet | `getWalletInfo(options)` | `getwalletinfo` |
| Wallet | `getHistory(options)` | `gethistory` |
| Wallet | `listCoins(options)` | `listcoins` |
| Wallet | `listUnspentCoins(options)` | `listunspentcoins` |
| Wallet | `getNewAddress(params, options)` | `getnewaddress` |
| Wallet | `listKeys(options)` | `listkeys` |
| Wallet | `send(params, options)` | `send` |
| Wallet | `build(params, options)` | `build` |
| Wallet | `buildUnsafeTransaction(params, options)` | `buildunsafetransaction` |
| Wallet | `speedUpTransaction(params, options)` | `speeduptransaction` |
| Wallet | `cancelTransaction(params, options)` | `canceltransaction` |
| Wallet | `excludeFromCoinJoin(params, options)` | `excludefromcoinjoin` |
| Wallet | `startCoinJoin(params, options)` | `startcoinjoin` |
| Wallet | `payInCoinJoin(params, options)` | `payincoinjoin` |
| Wallet | `listPaymentsInCoinJoin(options)` | `listpaymentsincoinjoin` |
| Wallet | `cancelPaymentInCoinJoin(params, options)` | `cancelpaymentincoinjoin` |
| Wallet | `startCoinJoinSweep(params, options)` | `startcoinjoinsweep` |
| Wallet | `stopCoinJoin(options)` | `stopcoinjoin` |

All 27 methods exposed by Wasabi's RPC service have named wrappers, including
`query`, which requires Wasabi's experimental `scripting` feature. See the
[Wasabi RPC service source](https://github.com/WalletWasabi/WalletWasabi/blob/master/WalletWasabi.Client/Rpc/WasabiJsonRpcService.cs)
for this method.

`send()` builds and broadcasts a transaction. `build()`,
`buildUnsafeTransaction()`, `speedUpTransaction()` and `cancelTransaction()`
return transaction hex in the response result without broadcasting it. Pass
that hex as `client.broadcast([response.result])` to broadcast it.
`buildUnsafeTransaction()` uses Wasabi's builder without overpayment protection.
`stop()` asks Wasabi to exit; it uses the usual response and transport error
handling.

Any RPC method is also accessible through `client.call(method, params, options)`
at the root endpoint or `wallet.call(method, params, options)` at that wallet's
endpoint. The method name is a non-empty string forwarded unchanged, with no
allowlist. These calls use the same authentication, transport, request queue,
timeouts and error handling as the named methods and return the complete
JSON-RPC response.

```js
const address = await wallet.getNewAddress(['Invoice', false])
const keys = await wallet.listKeys()
const transaction = await wallet.call('build', buildParams, { id: 'build-1' })
const status = await client.call('getstatus', undefined, { id: 'status-1' })
```

Omit `params` or pass `undefined` to omit it from the request. To set options on
a generic call without parameters, pass `undefined` as the second argument.
Parameters are serialized when the call is made, before it is queued, and
Wasabi validates their contents. `getNewAddress()` creates a new receiving
address; its parameters are forwarded just like `loadWallet()` parameters.

## Calling methods

Methods that require RPC parameters accept Wasabi's documented `params` value as
their first argument.

An optional final `options` argument can be used to specify the JSON-RPC request
ID.

```js
const params = ['My Wallet']
const options = { id: '2' }

const response = await client.loadWallet(params, options)

const wallet = client.wallet('My Wallet')
const history = await wallet.getHistory({ id: 'history-1' })
```

| Argument | Default | Description |
| --- | --- | --- |
| `params` | Required for methods with RPC parameters | Wasabi's documented `params` value, passed directly in its array or object form. |
| `options` | Optional | Pass `{ id: '2' }` to specify a non-empty string JSON-RPC request ID. If `options.id` is omitted or `undefined`, a UUID is generated automatically. The response ID must match the request ID. |

For methods without RPC parameters, the optional `options` object is the first
and only argument:

```js
const status = await client.getStatus({ id: 'status-1' })
```

## Responses

RPC methods resolve with the complete JSON-RPC response.

The library deliberately does not unwrap successful responses. Access the RPC
result through `response.result`.

For example:

```js
const response = await wallet.getWalletInfo()

console.log(response.result)
```

Server fields and values are otherwise preserved.

`createWallet()`, `recoverWallet()` and `loadWallet()` return the RPC response.
Use `client.wallet('Wallet name')` separately to access wallet-specific methods.

`getHistory()` returns Wasabi's history data without applying accounting
calculations or interpreting CoinJoin costs.

Requests made through a single client are sent serially. JSON-RPC batching is
not implemented.

The client does not automatically retry failed requests or follow HTTP
redirects.

## Errors

RPC methods may throw the errors below.

Set `rejectRpcErrors` in the client constructor to control how JSON-RPC error
responses are handled.

| Error class | When | Error object |
| --- | --- | --- |
| `TypeError` | Invalid constructor settings, wallet names, method names, request options or request IDs, or unserializable parameters | `error.message` |
| `WasabiTransportError` | Connection, proxy, timeout, body-read or transport-cleanup failure, or an RPC call after `close()` | `error.cause` for underlying failures |
| `WasabiHttpError` | Non-2xx HTTP response | `error.status`, `error.statusText`, `error.body`, `error.method` |
| `WasabiRpcError` | JSON-RPC error response when `rejectRpcErrors` is `true` | `error.response` contains the complete JSON-RPC error response. `error.message` equals `error.response.error.message`. |
| `WasabiResponseError` | Invalid JSON, malformed JSON-RPC response or mismatched response ID | `error.cause` is available for JSON parsing failures |

All `Wasabi*` error classes are exported and extend `WasabiError`.

### JSON-RPC errors

By default:

```js
const client = new WasabiClient({
  rpcUrl: process.env.WASABI_RPC_URL,
  rpcUsername: process.env.WASABI_RPC_USERNAME,
  rpcPassword: process.env.WASABI_RPC_PASSWORD,
  rejectRpcErrors: true
})
```

a JSON-RPC error response throws `WasabiRpcError`.

The complete server response remains available through:

```js
try {
  await client.loadWallet(['Missing Wallet'])
} catch (error) {
  console.log(error.response)
}
```

When `rejectRpcErrors` is `false`:

```js
const client = new WasabiClient({
  rpcUrl: process.env.WASABI_RPC_URL,
  rpcUsername: process.env.WASABI_RPC_USERNAME,
  rpcPassword: process.env.WASABI_RPC_PASSWORD,
  rejectRpcErrors: false
})

const response = await client.loadWallet(['Missing Wallet'])

console.log(response.error)
```

the complete JSON-RPC error response is returned instead of throwing
`WasabiRpcError`.

Transport, HTTP and malformed-response failures still throw normally.

The constructor and `wallet()` validate their inputs synchronously and may throw
`TypeError` immediately.

## Wasabi RPC notes

Wasabi's JSON-RPC server is disabled by default and must be enabled before this
library can connect to it.

A typical local Wasabi RPC endpoint is:

```text
http://127.0.0.1:37128/
```

Authentication is performed using HTTP Basic Authentication.

Wasabi processes RPC requests serially and does not support JSON-RPC batch
requests. `wasabi-api-node` follows this model and serializes requests made
through the same client instance.

Amounts returned by Wasabi are expressed in satoshis where specified by the
Wasabi RPC API.

Refer to the
[official Wasabi RPC documentation](https://docs.wasabiwallet.io/using-wasabi/RPC.html)
for RPC server configuration, individual method parameters and response
definitions.

For development setup and test commands, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
