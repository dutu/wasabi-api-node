export const requireOptions = function requireOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Options must be an object')
  }

  return options
}

export const requireString = function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`)
  }

  return value
}

export const requireWalletName = function requireWalletName(walletName) {
  requireString(walletName, 'walletName')

  if (walletName === '.' || walletName === '..') {
    throw new TypeError('walletName cannot be a URL dot segment')
  }

  try {
    encodeURIComponent(walletName)
  } catch (cause) {
    throw new TypeError('walletName must contain valid Unicode', { cause })
  }

  return walletName
}
