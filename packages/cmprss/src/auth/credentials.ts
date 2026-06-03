/**
 * AWS credential discovery for the proxy.
 *
 * v0 uses the AWS SDK's default provider chain (env, shared config, SSO cache,
 * container/IRSA, IMDS). No `gsa` bridge yet — assume users either have
 * AWS_PROFILE / AWS_ACCESS_KEY_ID set or have already `gsa use`'d.
 *
 * Returning `undefined` lets BedrockRuntimeClient use the SDK default itself,
 * which is identical behavior with one less indirection.
 */

import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export type CredentialsProvider = ReturnType<typeof fromNodeProviderChain>;

export function defaultCredentials(): CredentialsProvider {
  return fromNodeProviderChain();
}

/**
 * Verify credentials resolve at startup so we can fail fast with a useful
 * message instead of erroring on the first model call. Throws if no creds.
 */
export async function assertCredentialsAvailable(
  provider: CredentialsProvider,
): Promise<void> {
  try {
    await provider();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new NoCredentials(
      `no AWS credentials available.\n` +
        `  cmprss tried the AWS SDK default chain (env, AWS_PROFILE, SSO cache, IMDS).\n` +
        `  underlying error: ${detail}\n` +
        `  fix:  export AWS_PROFILE=...   or   gsa use aws <context>`,
    );
  }
}

export class NoCredentials extends Error {
  readonly code = "NO_CREDENTIALS";
  constructor(msg: string) {
    super(msg);
    this.name = "NoCredentials";
  }
}
