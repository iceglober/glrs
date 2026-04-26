/**
 * @glrs-dev/assume — platform resolution shim.
 *
 * The main npm package contains no binaries itself. Instead, one of five
 * platform-specific packages is installed via `optionalDependencies`, and
 * this shim locates the correct prebuilt binary at runtime.
 *
 * The pattern mirrors esbuild, swc, and turbo. No postinstall scripts are
 * involved — npm's `os` + `cpu` fields in each platform package cause
 * npm/pnpm/bun to skip packages that don't match the user's platform.
 */

import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);

type Platform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "win32-x64";

function detectPlatform(): Platform {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  throw new Error(
    `[@glrs-dev/assume] Unsupported platform: ${platform}-${arch}. ` +
      `Supported: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64. ` +
      `File an issue at https://github.com/iceglober/glrs/issues if you need another target.`,
  );
}

const BIN_NAME = process.platform === "win32" ? "gs-assume.exe" : "gs-assume";

/**
 * Resolve the path to the prebuilt binary for this platform.
 *
 * Throws a detailed error if the matching platform package isn't installed —
 * typically because the user ran `npm install --no-optional` or their package
 * manager's optional-dep resolution failed. In that case the fix is to install
 * the platform package directly:
 *
 *     npm i @glrs-dev/assume-<platform>
 *
 * Or to install the matching Rust crate: `cargo install glrs-assume`.
 */
export function getBinaryPath(): string {
  const platform = detectPlatform();
  const pkgName = `@glrs-dev/assume-${platform}`;

  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  } catch (err) {
    throw new Error(
      `[@glrs-dev/assume] Platform package '${pkgName}' not found. ` +
        `This usually means 'optionalDependencies' were skipped (e.g. 'npm install --no-optional'). ` +
        `Reinstall with optional deps enabled, or run 'npm i ${pkgName}' directly. ` +
        `Alternatively, 'cargo install glrs-assume' installs the native Rust binary.`,
      { cause: err },
    );
  }

  const pkgDir = path.dirname(pkgJsonPath);
  const binPath = path.join(pkgDir, "bin", BIN_NAME);

  if (!fs.existsSync(binPath)) {
    throw new Error(
      `[@glrs-dev/assume] Binary not found at ${binPath}. ` +
        `The platform package '${pkgName}' appears corrupted. Try reinstalling.`,
    );
  }

  return binPath;
}

export { BIN_NAME };
