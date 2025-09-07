// TODO: integrate libsignal-client (WASM) here.
// For now, we pass-through plaintext to prove plumbing. DO NOT SHIP THIS IN PRODUCTION.
export async function encryptFor(recipientId: string, bytes: Uint8Array): Promise<string> {
  return btoa(String.fromCharCode(...bytes))
}
export async function decryptFrom(senderId: string, b64: string): Promise<Uint8Array> {
  const bin = atob(b64); return new Uint8Array([...bin].map(c => c.charCodeAt(0)))
}
