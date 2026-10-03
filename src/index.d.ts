import type { Dispatcher } from 'undici'

export interface WasabiRequestOptions {
  /** Non-empty request ID. Defaults to a generated UUID. */
  id?: string | undefined
}

export type WasabiClientOptions<RejectRpcErrors extends boolean = boolean> = {
  /** Root HTTP(S) RPC URL, including any reverse-proxy prefix. */
  rpcUrl: string
  rpcUsername: string
  rpcPassword: string
  /** Integer between 1 and 2147483647; defaults to 30000 milliseconds. */
  timeoutMs?: number | undefined
  /** Defaults to true. False returns RPC error envelopes instead of throwing. */
  rejectRpcErrors?: RejectRpcErrors | undefined
} & (
  | {
    /** SOCKS5 URL. Destination hostnames are resolved by the proxy. */
    proxyUrl?: string | undefined
    proxyPooling?: false | undefined
    dispatcher?: undefined
  }
  | {
    proxyUrl: string
    /** Reuse proxy connections until client.close(); defaults to false. */
    proxyPooling?: boolean | undefined
    dispatcher?: undefined
  }
  | {
    proxyUrl?: undefined
    proxyPooling?: false | undefined
    /** Caller-owned Undici-compatible dispatcher; the client never closes it. */
    dispatcher: Pick<Dispatcher, 'dispatch'>
  }
)

export interface WasabiRpcErrorDetails {
  code: number
  message: string
  data?: unknown
  [field: string]: unknown
}

export interface WasabiRpcSuccessResponse<Result = unknown> {
  jsonrpc: '2.0'
  id: string
  /** Wasabi may omit result, including for methods that return no value. */
  result?: Result | undefined
  error?: never
  [field: string]: unknown
}

export interface WasabiRpcErrorResponse {
  jsonrpc: '2.0'
  id: string
  result?: never
  error: WasabiRpcErrorDetails
  [field: string]: unknown
}

/** Complete server envelope. Result schemas are supplied by the caller. */
export type WasabiRpcResponse<Result = unknown, RejectRpcErrors extends boolean = boolean> =
  RejectRpcErrors extends true
    ? WasabiRpcSuccessResponse<Result>
    : WasabiRpcSuccessResponse<Result> | WasabiRpcErrorResponse

/** Connection settings are immutable. All requests share a serial queue. */
export class WasabiClient<RejectRpcErrors extends boolean = true> {
  constructor(options: WasabiClientOptions<RejectRpcErrors>)

  /** Drain accepted requests and close the owned proxy pool. Reject new calls; never close caller-owned dispatchers. */
  close(): Promise<void>

  /** Parameters are forwarded unchanged; undefined omits params. Wasabi validates their contents. */
  call<Result = unknown>(method: string, params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  getStatus<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  listWallets<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  getFeeRates<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  loadWallet<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  createWallet<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  recoverWallet<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  broadcast<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  /** Execute a Scheme script; requires Wasabi's experimental scripting feature. */
  query<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  stop<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  /** Create a local handle without loading the wallet or making an RPC request. */
  wallet(walletName: string): WasabiWallet<RejectRpcErrors>
}

/** A wallet handle obtained through client.wallet(); exported as a type only. */
export interface WasabiWallet<RejectRpcErrors extends boolean = boolean> {
  readonly walletName: string
  call<Result = unknown>(method: string, params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  getWalletInfo<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  getHistory<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  listCoins<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  listUnspentCoins<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  getNewAddress<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  listKeys<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  /** Build and broadcast a transaction. */
  send<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  /** Build a transaction without broadcasting it. */
  build<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  buildUnsafeTransaction<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  speedUpTransaction<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  cancelTransaction<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  excludeFromCoinJoin<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  startCoinJoin<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  payInCoinJoin<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  listPaymentsInCoinJoin<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  cancelPaymentInCoinJoin<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  startCoinJoinSweep<Result = unknown>(params?: unknown, options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
  stopCoinJoin<Result = unknown>(options?: WasabiRequestOptions): Promise<WasabiRpcResponse<Result, RejectRpcErrors>>
}

export class WasabiError extends Error {
  constructor(message?: string, options?: ErrorOptions)
}

export class WasabiTransportError extends WasabiError {}

export class WasabiHttpError extends WasabiError {
  constructor(method: string, response: { status: number; statusText: string }, body: string)
  method: string
  status: number
  statusText: string
  body: string
}

export class WasabiResponseError extends WasabiError {}

export class WasabiRpcError extends WasabiError {
  constructor(method: string, response: WasabiRpcErrorResponse)
  method: string
  code: number
  data: unknown
  response: WasabiRpcErrorResponse
}
