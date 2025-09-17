// NaCl-based ephemeral box crypto for MVP
// npm i tweetnacl
import nacl from 'tweetnacl'

// tiny helpers
const b64 = {
  enc: (u: Uint8Array) => btoa(String.fromCharCode(...u)),
  dec: (s: string) => new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0))),
}
const LS = {
  get(k: string) { const v = localStorage.getItem(k); return v ? b64.dec(v) : null },
  set(k: string, u: Uint8Array) { localStorage.setItem(k, b64.enc(u)) },
}

// persistent identity key (Curve25519 for box)
export function ensureIdentity(): { pub: Uint8Array, sec: Uint8Array } {
  let pub = LS.get('id_pub'), sec = LS.get('id_sec')
  if (!pub || !sec) {
    const kp = nacl.box.keyPair()
    pub = kp.publicKey; sec = kp.secretKey
    LS.set('id_pub', pub); LS.set('id_sec', sec)
  }
  return { pub, sec }
}

// export our public identity key for registration
export function myIdentityPubB64(): string {
  return b64.enc(ensureIdentity().pub)
}

// Encrypt for recipient whose identity key is known (base64)
export async function encryptFor(recipientId: string, plaintext: Uint8Array): Promise<string> {
  // fetch recipient public key (we reuse your /prekeys route; it returns identityKeyPubB64)
  const res = await fetch(`${import.meta.env.VITE_API_URL}/prekeys/${recipientId}`)
  if (!res.ok) throw new Error('peer prekeys not found')
  const bundle = await res.json()
  const rpub = b64.dec(bundle.identityKeyPubB64) // 32 bytes

  // ephemeral sender key + random nonce
  const eph = nacl.box.keyPair()
  const nonce = nacl.randomBytes(nacl.box.nonceLength)

  // encrypt
  const box = nacl.box(plaintext, nonce, rpub, eph.secretKey) // Uint8Array

  // pack: [Epub(32) | nonce(24) | box]
  const packed = new Uint8Array(32 + 24 + box.length)
  packed.set(eph.publicKey, 0)
  packed.set(nonce, 32)
  packed.set(box, 32 + 24)

  return b64.enc(packed)
}

// Decrypt from sender (ciphertext base64 includes Epub + nonce + box)
export async function decryptFrom(_senderId: string, ciphertextB64: string): Promise<Uint8Array> {
  const me = ensureIdentity()
  const packed = b64.dec(ciphertextB64)
  if (packed.length < 32 + 24) throw new Error('bad ciphertext')

  const epk = packed.slice(0, 32)
  const nonce = packed.slice(32, 32 + 24)
  const box = packed.slice(32 + 24)

  const plain = nacl.box.open(box, nonce, epk, me.sec)
  if (!plain) throw new Error('decryption failed')
  return plain
}
