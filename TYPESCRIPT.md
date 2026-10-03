# TypeScript

TypeScript declarations are included in the package. Client settings, request
options, wallet handles and error classes are typed automatically.

RPC methods return the complete JSON-RPC envelope. Results default to `unknown`
because the library does not validate Wasabi's result schemas. Supply a result
type to any named method or generic `call()` when you know the server's schema:

```ts
import { WasabiClient } from 'wasabi-api-node'
import type { WasabiWallet } from 'wasabi-api-node'

const client = new WasabiClient({
  rpcUrl: 'http://127.0.0.1:37128/',
  rpcUsername: 'rpc-user',
  rpcPassword: 'rpc-password'
})

const wallet: WasabiWallet<true> = client.wallet('My Wallet')
const response = await wallet.getWalletInfo<{ walletName: string }>()
console.log(response.result?.walletName)
```

`result` is optional because Wasabi may return an envelope without it. Parameters
are typed as `unknown` and forwarded to Wasabi for validation, as in JavaScript.
With `rejectRpcErrors: false` (or a dynamic boolean), the response type also
includes JSON-RPC error envelopes. Check `response.error` before using the result.
The exported `WasabiClientOptions`, `WasabiRequestOptions`, `WasabiRpcResponse`,
`WasabiRpcSuccessResponse`, `WasabiRpcErrorResponse` and `WasabiRpcErrorDetails`
types can be used in your own interfaces. `WasabiWallet` is a type-only export;
create wallet handles through `client.wallet()`.

See the [README](./README.md) for connection settings and the complete API.
