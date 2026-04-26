# @glrs-dev/assume-linux-x64

Prebuilt `gs-assume` binary for Linux x64.

This is an **internal** distribution package. You should not install this directly. Instead install the main package:

```bash
npm i -g @glrs-dev/assume
```

The main package lists this one as an `optionalDependency`. npm and pnpm and bun all honor the `os` + `cpu` fields in this package's `package.json`, so only users on linux-x64 will actually download this tarball.

If you hit a "platform package not found" error from `@glrs-dev/assume`, you may have run `npm install --no-optional` or have a package manager that silently skipped the optional dep. In that case install this package explicitly:

```bash
npm i @glrs-dev/assume-linux-x64
```

Or install the native Rust binary directly:

```bash
cargo install glrs-assume
```

See the [main package](https://www.npmjs.com/package/@glrs-dev/assume) for usage, or [glrs.dev/assume](https://glrs.dev/assume) for full docs.

## License

MIT — see the [repo](https://github.com/iceglober/glrs).
