# Custom TLS and dispatchers

Pass an [Undici Agent](https://github.com/nodejs/undici/blob/main/docs/docs/api/Agent.md)
as `dispatcher` to trust a private CA for this client without setting
`NODE_EXTRA_CA_CERTS` globally. Install `undici` as a direct dependency in your
application to import it.

```js
import { readFileSync } from 'node:fs'
import { Agent } from 'undici'
import { WasabiClient } from 'wasabi-api-node'

const dispatcher = new Agent({
  connect: {
    ca: readFileSync('./private-ca.pem')
  }
})

const client = new WasabiClient({
  rpcUrl: 'https://rpc.example.com/wasabi/',
  rpcUsername: process.env.WASABI_RPC_USERNAME,
  rpcPassword: process.env.WASABI_RPC_PASSWORD,
  dispatcher
})

try {
  const status = await client.getStatus()
  console.log(status.result)
} finally {
  await dispatcher.close()
}
```

For mutual TLS, also supply `cert: readFileSync('./client-cert.pem')` and
`key: readFileSync('./client-key.pem')` in the Agent's `connect` options.
Certificate and hostname verification remain enabled by default.

The same dispatcher is used for all root and wallet requests on the client. It
may be shared between clients. The caller owns its lifecycle: the library never
closes or destroys it, including after failed requests. Close it after all clients
using it have finished. Client timeouts still apply to dispatched requests.

See the [README](../README.md) for other connection options and the complete API.
