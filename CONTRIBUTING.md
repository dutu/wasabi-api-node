# Contributing

## Development and tests

This repository uses Yarn 4 with Plug'n'Play (PnP). Install dependencies and run
the tests locally or in CI with:

```sh
yarn install --immutable
yarn test
```

`yarn test` runs the runtime tests and strict TypeScript consumer checks using
both NodeNext and bundler module resolution. To run only the declaration checks:

```sh
yarn test:types
```

Yarn enables the PnP loaders automatically. To run Node directly after a Yarn
install, enable both loaders explicitly:

```sh
node --require ./.pnp.cjs --loader ./.pnp.loader.mjs --test
```

Bare `node --test` and `npm test` require a conventional `node_modules` install;
they do not enable Yarn's PnP loaders. The HTTPS test subprocesses inherit both
Node loader arguments and `NODE_OPTIONS` from the test runner.

## Live integration test

The live test is skipped unless `WASABI_RPC_URL` is set. To run it against a
running Wasabi node with RPC enabled, set the URL and the credentials matching
Wasabi's `JsonRpcUser` and `JsonRpcPassword`:

```sh
export WASABI_RPC_URL='http://127.0.0.1:37128/'
export WASABI_RPC_USERNAME='your-rpc-user'
export WASABI_RPC_PASSWORD='your-rpc-password'
yarn test:live
```

It checks the success envelope and request ID, valid Basic Auth, HTTP 401 for an
incorrect password, and a real method-not-found error in both throwing and
returning modes. It calls only `getstatus` and an unknown method; no wallet needs
to be loaded and wallet state is unchanged. Each request has a 10-second timeout.

`yarn test` also includes this test when `WASABI_RPC_URL` is set. Missing
credentials, invalid configuration and connection failures fail the test rather
than skipping it. See the [official RPC setup instructions](https://docs.wasabiwallet.io/using-wasabi/RPC.html#configure-rpc)
for server configuration.
