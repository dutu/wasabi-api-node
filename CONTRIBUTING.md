# Contributing

## Development and tests

This repository uses Yarn 4 with Plug'n'Play (PnP). Install dependencies and run
the tests locally or in CI with:

```sh
yarn install --immutable
yarn test
```

Yarn enables the PnP loaders automatically. To run Node directly after a Yarn
install, enable both loaders explicitly:

```sh
node --require ./.pnp.cjs --loader ./.pnp.loader.mjs --test
```

Bare `node --test` and `npm test` require a conventional `node_modules` install;
they do not enable Yarn's PnP loaders. The HTTPS test subprocesses inherit both
Node loader arguments and `NODE_OPTIONS` from the test runner.
