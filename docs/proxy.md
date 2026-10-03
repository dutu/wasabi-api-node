# SOCKS5 proxy support

Configure a SOCKS5 proxy with `proxyUrl`. For Wasabi server setup, see the
[official onion-service guide](https://docs.wasabiwallet.io/using-wasabi/RPC.html#expose-the-rpc-server-as-an-onion-service).

For example:

```js
import { WasabiClient } from 'wasabi-api-node'

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

## Authentication

If proxy authentication is required, include URL-encoded credentials:

```text
socks5h://username:password@127.0.0.1:9050
```

## Connection pooling

By default, every proxied request creates its own dispatcher and releases the
tunnel after reading the response body, including after failures. To avoid a
new SOCKS handshake for each request over Tor, enable connection pooling:

```js
import { WasabiClient } from 'wasabi-api-node'

const client = new WasabiClient({
  rpcUrl: 'http://exampleonionaddress.onion/',
  rpcUsername: process.env.WASABI_RPC_USERNAME,
  rpcPassword: process.env.WASABI_RPC_PASSWORD,
  proxyUrl: 'socks5h://127.0.0.1:9050',
  proxyPooling: true
})

try {
  await client.getStatus()
  await client.wallet('Savings').getWalletInfo()
} finally {
  await client.close()
}
```

The pool belongs to this client and reuses one connection per origin for root
and wallet requests when the server permits keep-alive. Closed or failed
connections are replaced as needed; failed RPC requests are not retried.

`close()` waits for all requests accepted before it was called, then releases
the owned pool. It can be called repeatedly and returns the same promise. Once
closing starts, new RPC calls through the client or its wallet handles reject
with `WasabiTransportError`. It also works without pooling and never closes a
caller-owned `dispatcher`; close that dispatcher separately after its clients
have finished.

See the [README](../README.md) for other connection options and the complete API.
