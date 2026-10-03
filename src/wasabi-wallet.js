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
}
