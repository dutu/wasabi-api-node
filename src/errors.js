export class WasabiError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = new.target.name
  }
}

export class WasabiTransportError extends WasabiError {}

export class WasabiHttpError extends WasabiError {
  constructor(method, response, body) {
    super(`Wasabi ${method} failed with HTTP ${response.status} ${response.statusText}`.trim())
    this.method = method
    this.status = response.status
    this.statusText = response.statusText
    this.body = body
  }
}

export class WasabiResponseError extends WasabiError {}

export class WasabiRpcError extends WasabiError {
  constructor(method, response) {
    super(response.error.message)
    this.method = method
    this.code = response.error.code
    this.data = response.error.data
    this.response = response
  }
}
