/** A wallet handle created by WasabiClient, using its private shared transport. */
export class WasabiWallet {
  #walletName
  #request

  constructor(walletName, request) {
    this.#walletName = walletName
    this.#request = request
  }

  get walletName() {
    return this.#walletName
  }

  /**
   * Call any RPC method at this wallet's endpoint and return the complete response.
   * @param {string} method Wasabi RPC method name, forwarded unchanged
   * @param {object|Array<*>} [params] Wasabi's params value; undefined omits it
   * @param {object} [options] Request options
   * @param {string} [options.id] Request ID; defaults to a generated UUID
   */
  call(method, params, options) {
    return this.#request(method, options, params)
  }

  /** Forward Wasabi's address parameters without interpreting them. */
  getNewAddress(params, options) {
    return this.#request('getnewaddress', options, params)
  }

  listKeys(options) {
    return this.#request('listkeys', options)
  }

  getWalletInfo(options) {
    return this.#request('getwalletinfo', options)
  }

  /** Return Wasabi's history unchanged, including its original amount units. */
  getHistory(options) {
    return this.#request('gethistory', options)
  }

  listCoins(options) {
    return this.#request('listcoins', options)
  }

  listUnspentCoins(options) {
    return this.#request('listunspentcoins', options)
  }

  /** Build and broadcast a transaction. */
  send(params, options) {
    return this.#request('send', options, params)
  }

  /** Build a transaction without broadcasting it. */
  build(params, options) {
    return this.#request('build', options, params)
  }

  /** Build a transaction without Wasabi's overpayment protection. */
  buildUnsafeTransaction(params, options) {
    return this.#request('buildunsafetransaction', options, params)
  }

  speedUpTransaction(params, options) {
    return this.#request('speeduptransaction', options, params)
  }

  cancelTransaction(params, options) {
    return this.#request('canceltransaction', options, params)
  }

  excludeFromCoinJoin(params, options) {
    return this.#request('excludefromcoinjoin', options, params)
  }

  startCoinJoin(params, options) {
    return this.#request('startcoinjoin', options, params)
  }

  payInCoinJoin(params, options) {
    return this.#request('payincoinjoin', options, params)
  }

  listPaymentsInCoinJoin(options) {
    return this.#request('listpaymentsincoinjoin', options)
  }

  cancelPaymentInCoinJoin(params, options) {
    return this.#request('cancelpaymentincoinjoin', options, params)
  }

  startCoinJoinSweep(params, options) {
    return this.#request('startcoinjoinsweep', options, params)
  }

  stopCoinJoin(options) {
    return this.#request('stopcoinjoin', options)
  }
}
