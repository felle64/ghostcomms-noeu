// NaCl-based ephemeral box crypto for MVP
// npm i tweetnacl
import nacl from 'tweetnacl'
import { API } from '../api'

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
  // use centralized base (handles env + localhost fallback)
  const url = API.url(`/prekeys/${encodeURIComponent(recipientId)}`)

  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`prekeys fetch failed (${res.status}) ${body.slice(0,120)}`)
  }

  let bundle: any
  try { bundle = await res.json() }
  catch (e) {
    const body = await res.text().catch(()=>'')
    throw new Error(`prekeys parse failed: ${(e as Error).message} :: ${body.slice(0,120)}`)
  }

  const rpubB64 = bundle?.identityKeyPubB64
  if (!rpubB64) throw new Error('prekeys missing identityKeyPubB64')

  const rpub = new Uint8Array(atob(rpubB64).split('').map(c => c.charCodeAt(0)))
  if (rpub.length !== 32) throw new Error(`peer key length ${rpub.length} (expected 32)`)

  const eph = nacl.box.keyPair()
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const box = nacl.box(plaintext, nonce, rpub, eph.secretKey)

  const packed = new Uint8Array(32 + 24 + box.length)
  packed.set(eph.publicKey, 0)
  packed.set(nonce, 32)
  packed.set(box, 56)
  return btoa(String.fromCharCode(...packed))
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
