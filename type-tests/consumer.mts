import { Agent } from 'undici'
import {
  WasabiClient,
  WasabiError,
  WasabiTransportError,
  WasabiHttpError,
  WasabiResponseError,
  WasabiRpcError
} from 'wasabi-api-node'
import type {
  WasabiClientOptions,
  WasabiRequestOptions,
  WasabiRpcErrorDetails,
  WasabiRpcErrorResponse,
  WasabiRpcResponse,
  WasabiRpcSuccessResponse,
  WasabiWallet
} from 'wasabi-api-node'

const credentials = {
  rpcUrl: 'http://127.0.0.1:37128/',
  rpcUsername: 'user',
  rpcPassword: 'password'
}
const options: WasabiRequestOptions = { id: 'request-1' }
const client = new WasabiClient(credentials)
const wallet: WasabiWallet<true> = client.wallet('Savings')
const walletName: string = wallet.walletName

const rootResponses: Promise<WasabiRpcSuccessResponse>[] = [
  client.getStatus(options),
  client.listWallets(),
  client.getFeeRates(),
  client.loadWallet(['Savings'], options),
  client.createWallet({ walletName: 'Savings', password: 'password' }),
  client.recoverWallet(['Savings', 'password', 'mnemonic']),
  client.broadcast(['transaction']),
  client.query(['script']),
  client.stop(),
  client.call('getstatus', undefined, options)
]
const walletResponses: Promise<WasabiRpcSuccessResponse>[] = [
  wallet.getWalletInfo(options),
  wallet.getHistory(),
  wallet.listCoins(),
  wallet.listUnspentCoins(),
  wallet.getNewAddress(['Invoice', false], options),
  wallet.listKeys(),
  wallet.send({ payments: [] }),
  wallet.build([]),
  wallet.buildUnsafeTransaction([]),
  wallet.speedUpTransaction([]),
  wallet.cancelTransaction([]),
  wallet.excludeFromCoinJoin([]),
  wallet.startCoinJoin([]),
  wallet.payInCoinJoin([]),
  wallet.listPaymentsInCoinJoin(),
  wallet.cancelPaymentInCoinJoin([]),
  wallet.startCoinJoinSweep([]),
  wallet.stopCoinJoin(),
  wallet.call('custommethod', { futureOption: true }, options)
]

interface WalletInfo { walletName: string; loaded: boolean }
const info = await wallet.getWalletInfo<WalletInfo>()
const loaded: boolean | undefined = info.result?.loaded
const custom = await client.call<{ value: number }>('futuremethod')
const value: number | undefined = custom.result?.value
const transaction = await wallet.build<string>([])
const hex: string | undefined = transaction.result
const unknownResponse = await client.getStatus()
// @ts-expect-error Server result schemas default to unknown.
unknownResponse.result.someField
// @ts-expect-error Wasabi can omit result even on a successful response.
const requiredResult: WalletInfo = info.result

const returningErrors = new WasabiClient({ ...credentials, rejectRpcErrors: false })
const response = await returningErrors.wallet('Savings').getWalletInfo<WalletInfo>()
if (response.error) {
  const code: number = response.error.code
  const errorResponse: WasabiRpcErrorResponse = response
} else {
  const result: WalletInfo | undefined = response.result
}
// @ts-expect-error Clients configured to return errors may resolve with an error envelope.
const successOnly: WasabiRpcSuccessResponse<WalletInfo> = response

declare const rejectRpcErrors: boolean
const dynamic = new WasabiClient({ ...credentials, rejectRpcErrors })
const dynamicResponse: WasabiRpcResponse<WalletInfo> = await dynamic.getStatus<WalletInfo>()
// @ts-expect-error A dynamic error policy must also account for returned errors.
const dynamicSuccess: WasabiRpcSuccessResponse<WalletInfo> = dynamicResponse
const explicitTrue: WasabiRpcSuccessResponse = await new WasabiClient({
  ...credentials, rejectRpcErrors: true
}).getStatus()
const configuredOptions: WasabiClientOptions<false> = { ...credentials, rejectRpcErrors: false }
const configuredResponse: WasabiRpcResponse = await new WasabiClient(configuredOptions).getStatus()

new WasabiClient({ ...credentials, dispatcher: new Agent() })
new WasabiClient({ ...credentials, dispatcher: { dispatch() { return true } } })
new WasabiClient({ ...credentials, proxyUrl: 'socks5h://127.0.0.1:9050' })
new WasabiClient({ ...credentials, timeoutMs: undefined, rejectRpcErrors: undefined })
client.getStatus({ id: undefined })
client.loadWallet(undefined)
wallet.startCoinJoin()

// @ts-expect-error Connection settings are required.
new WasabiClient()
// @ts-expect-error Credentials are required.
new WasabiClient({ rpcUrl: credentials.rpcUrl })
// @ts-expect-error RPC error policy must be a boolean.
new WasabiClient({ ...credentials, rejectRpcErrors: 'false' })
// @ts-expect-error A dispatcher and proxyUrl cannot be supplied together.
new WasabiClient({ ...credentials, dispatcher: new Agent(), proxyUrl: 'socks5://localhost:9050' })
// @ts-expect-error Dispatch must be a method.
new WasabiClient({ ...credentials, dispatcher: { dispatch: true } })
// @ts-expect-error Request IDs are strings.
client.getStatus({ id: 2 })
// @ts-expect-error Method names are strings.
client.call(123)
// @ts-expect-error Wallet names are strings.
client.wallet(['Savings'])
// @ts-expect-error Wallet names cannot be reassigned.
wallet.walletName = 'Spending'
// @ts-expect-error Wallet-only methods are not available on the root client.
client.send([])
// @ts-expect-error Root-only methods are not available on wallet handles.
wallet.getStatus()
// @ts-expect-error The low-level transport is private.
client.request('getstatus')
// @ts-expect-error WasabiWallet is exported as a type, with no runtime constructor.
new WasabiWallet()
// @ts-expect-error Package subpaths are not exported.
await import('wasabi-api-node/src/wasabi-wallet.js')

const details: WasabiRpcErrorDetails = { code: -32602, message: 'Invalid params', data: null }
const envelope: WasabiRpcErrorResponse = { jsonrpc: '2.0', id: 'request-1', error: details, extension: true }
const rpcError = new WasabiRpcError('loadwallet', envelope)
const method: string = rpcError.method
const code: number = rpcError.code
const data: unknown = rpcError.data
const preservedResponse: WasabiRpcErrorResponse = rpcError.response
const httpError = new WasabiHttpError('getstatus', { status: 401, statusText: 'Unauthorized' }, 'failure')
const status: number = httpError.status
const statusText: string = httpError.statusText
const body: string = httpError.body
const baseErrors: WasabiError[] = [
  rpcError,
  httpError,
  new WasabiError('failure'),
  new WasabiTransportError('failure', { cause: new Error('network') }),
  new WasabiResponseError('failure', { cause: new SyntaxError('invalid JSON') })
]
// @ts-expect-error A response cannot contain both result and error.
const mixedEnvelope: WasabiRpcResponse = { jsonrpc: '2.0', id: 'request-1', result: null, error: details }
const emptyEnvelope: WasabiRpcSuccessResponse = { jsonrpc: '2.0', id: 'request-1' }
