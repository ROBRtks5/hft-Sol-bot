declare module 'ed25519-hd-key' {
  export function derivePath(
    path: string,
    seedHex: string,
    offset?: number,
    Key?: string
  ): { key: Uint8Array; chainCode: Uint8Array };
  export function getMasterKeyFromSeed(seedHex: string): { key: Uint8Array; chainCode: Uint8Array };
}
