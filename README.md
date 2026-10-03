# wasabi-api-node

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

## Connection options

Pass these settings to `new WasabiClient({ ... })`:

| Option | Default | Description |
| --- | --- | --- |
| `rpcUrl` | No default | Required root HTTP or HTTPS URL, including any port or reverse-proxy prefix, e.g. `http://127.0.0.1:37128/` or `https://rpc.example.com/wasabi/`. URL credentials, query strings and fragments are rejected. |
| `rpcUsername` | No default | Required non-empty HTTP Basic Auth username. Cannot contain `:`. |
| `rpcPassword` | No default | Required non-empty HTTP Basic Auth password. |
| `proxyUrl` | None | Optional `socks5h://` or `socks5://` proxy URL with an explicit port, e.g. `socks5h://127.0.0.1:9050`. Both schemes delegate destination hostname resolution to the proxy. Proxy authentication may be supplied using a URL-encoded username and password. See Wasabi's [onion-service setup](https://docs.wasabiwallet.io/using-wasabi/RPC.html#expose-the-rpc-server-as-an-onion-service). |
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
| Client | `getStatus()` | `getstatus` |
| Client | `listWallets()` | `listwallets` |
| Client | `getFeeRates()` | `getfeerates` |
| Client | `loadWallet()` | `loadwallet` |
| Wallet | `getWalletInfo()` | `getwalletinfo` |
| Wallet | `getHistory()` | `gethistory` |
| Wallet | `listCoins()` | `listcoins` |
| Wallet | `listUnspentCoins()` | `listunspentcoins` |

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

`loadWallet()` returns the RPC response and does not return a wallet interface.
Use `client.wallet('Wallet name')` separately to access wallet-specific methods.

`getHistory()` returns Wasabi's history data without applying accounting
calculations or interpreting CoinJoin costs.

Requests made through a single client are sent serially. JSON-RPC batching is
not implemented.

The client does not automatically retry failed requests or follow HTTP
redirects.

## SOCKS5 proxy support

A SOCKS5 proxy can be configured with `proxyUrl`.

For example:

```js
const client = new WasabiClient({
  rpcUrl: 'http://exampleonionaddress.onion/',
  rpcUsername: process.env.WASABI_RPC_USERNAME,
  rpcPassword: process.env.WASABI_RPC_PASSWORD,
  proxyUrl: 'socks5h://127.0.0.1:9050'
})
```

In this library, `socks5h://` and `socks5://` behave identically: both pass
destination hostnames unchanged to the proxy for resolution, including `.onion`
addresses. Neither scheme resolves destination hostnames locally.

If proxy authentication is required, include URL-encoded credentials:

```text
socks5h://username:password@127.0.0.1:9050
```

## Errors

RPC methods may throw the errors below.

Set `rejectRpcErrors` in the client constructor to control how JSON-RPC error
responses are handled.

| Error class | When | Error object |
| --- | --- | --- |
| `TypeError` | Invalid constructor settings, wallet names, request options or request IDs | `error.message` |
| `WasabiTransportError` | Connection, proxy, timeout, body-read or transport-cleanup failure | `error.cause` |
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

## License

[MIT](./LICENSE)
