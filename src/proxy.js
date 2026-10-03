import { Buffer } from 'node:buffer'
import { Agent, buildConnector } from 'undici'
import { SocksClient } from 'socks'
import { requireString } from './options.js'

export const createProxyDispatcherFactory = function createProxyDispatcherFactory(proxyUrl, timeoutMs) {
  if (proxyUrl === undefined) {
    return undefined
  }

  requireString(proxyUrl, 'proxyUrl')
  const url = new URL(proxyUrl)

  if (!['socks5:', 'socks5h:'].includes(url.protocol)) {
    throw new TypeError('proxyUrl must use socks5:// or socks5h://')
  }

  if (!url.hostname || (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash) {
    throw new TypeError('proxyUrl must contain a proxy host and port, with optional credentials and no path, query or fragment')
  }

  if (url.port === '') {
    throw new TypeError('proxyUrl must include an explicit port')
  }

  const port = Number(url.port)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('proxyUrl port must be an integer between 1 and 65535')
  }

  let username
  let password

  if (url.username || url.password) {
    try {
      username = decodeURIComponent(url.username)
      password = decodeURIComponent(url.password)
    } catch (cause) {
      throw new TypeError('proxyUrl credentials must be valid URL-encoded strings', { cause })
    }

    if ([username, password].some((value) => Buffer.byteLength(value, 'utf8') < 1 || Buffer.byteLength(value, 'utf8') > 255)) {
      throw new TypeError('proxyUrl username and password must both contain 1 to 255 UTF-8 bytes')
    }
  }

  const proxy = {
    host: url.hostname.replace(/^\[|\]$/gu, ''),
    port,
    type: 5,
    userId: username,
    password
  }

  const connect = async function connect(options) {
    const started = performance.now()
    const hostname = options.hostname.replace(/^\[|\]$/gu, '')

    // Passing the hostname unchanged delegates destination DNS to the proxy.
    const { socket } = await SocksClient.createConnection({
      command: 'connect',
      proxy,
      destination: {
        host: hostname,
        port: Number(options.port || (options.protocol === 'https:' ? 443 : 80))
      },
      timeout: timeoutMs,
      set_tcp_nodelay: true
    })

    if (options.protocol !== 'https:') {
      return socket
    }

    try {
      const remaining = Math.max(1, timeoutMs - Math.ceil(performance.now() - started))
      const connectTls = buildConnector({ timeout: remaining })
      return await new Promise((resolve, reject) => {
        connectTls({ ...options, hostname, httpSocket: socket }, (error, secureSocket) => {
          if (error) {
            reject(error)
          } else {
            resolve(secureSocket)
          }
        })
      })
    } catch (error) {
      socket.destroy()
      throw error
    }
  }

  return () => new Agent({
    connect: (options, callback) => {
      connect(options).then((socket) => callback(null, socket), (error) => callback(error, null))
    }
  })
}
