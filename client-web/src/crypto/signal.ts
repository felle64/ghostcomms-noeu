// NaCl-based ephemeral box crypto for MVP with multi-device support
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
    pub = Uint8Array.from(kp.publicKey); sec = Uint8Array.from(kp.secretKey)
    if (pub && sec) {
      LS.set('id_pub', pub)
      LS.set('id_sec', sec)
    }
  }
  if (!pub || !sec) {
    throw new Error('Failed to generate or retrieve identity keys');
  }
  return { pub, sec }
}

// export our public identity key for registration
export function myIdentityPubB64(): string {
  const pub = ensureIdentity().pub;
  if (!pub) {
    throw new Error("Identity public key is null");
  }
  return b64.enc(pub);
}

// Check if recipient is a username or deviceId
function isUsername(recipient: string): boolean {
  // Usernames are alphanumeric with underscores, 3-30 chars
  // Device IDs are typically cuid format (starts with 'c' followed by random chars)
  return /^[a-zA-Z0-9_]{3,30}$/.test(recipient) && !recipient.startsWith('c')
}

// Get device info for a recipient (username or deviceId)
async function getRecipientDevice(recipient: string): Promise<{
  deviceId: string
  identityKeyPubB64: string
}> {
  const jwt = localStorage.getItem('jwt')
  const headers: HeadersInit = { Accept: 'application/json' }
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`
  }

  if (isUsername(recipient)) {
    // Recipient is a username - get their first/primary device
    const url = API.url(`/user/${encodeURIComponent(recipient)}`)
    const res = await fetch(url, { headers })
    
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`User not found (${res.status}) ${body.slice(0,120)}`)
    }

    let userData: any
    try { userData = await res.json() }
    catch (e) {
      const body = await res.text().catch(()=>'')
      throw new Error(`User data parse failed: ${(e as Error).message}`)
    }

    if (!userData?.devices || userData.devices.length === 0) {
      throw new Error('User has no registered devices')
    }

    // For now, use the first device (in a full implementation, you might encrypt for all devices)
    const device = userData.devices[0]
    return {
      deviceId: device.deviceId,
      identityKeyPubB64: device.identityKeyPubB64
    }
  } else {
    // Recipient is a deviceId - get prekeys directly
    const url = API.url(`/prekeys/${encodeURIComponent(recipient)}`)
    const res = await fetch(url, { headers })
    
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Device prekeys fetch failed (${res.status}) ${body.slice(0,120)}`)
    }

    let bundle: any
    try { bundle = await res.json() }
    catch (e) {
      const body = await res.text().catch(()=>'')
      throw new Error(`Prekeys parse failed: ${(e as Error).message}`)
    }

    if (!bundle?.identityKeyPubB64) {
      throw new Error('Device prekeys missing identityKeyPubB64')
    }

    return {
      deviceId: recipient,
      identityKeyPubB64: bundle.identityKeyPubB64
    }
  }
}

// Encrypt for recipient (username or deviceId)
export async function encryptFor(recipient: string, plaintext: Uint8Array): Promise<string> {
  try {
    // Get the device info for this recipient
    const deviceInfo = await getRecipientDevice(recipient)
    
    // Now fetch the full prekey bundle for the specific device
    const url = API.url(`/prekeys/${encodeURIComponent(deviceInfo.deviceId)}`)
    const jwt = localStorage.getItem('jwt')
    const headers: HeadersInit = { Accept: 'application/json' }
    if (jwt) {
      headers['Authorization'] = `Bearer ${jwt}`
    }

    const res = await fetch(url, { headers })
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
  } catch (error) {
    console.error('encryptFor error:', error)
    throw error
  }
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

// Multi-device encryption (for future use)
export async function encryptForAllDevices(username: string, plaintext: Uint8Array): Promise<Array<{
  deviceId: string
  ciphertext: string
}>> {
  const jwt = localStorage.getItem('jwt')
  const headers: HeadersInit = { Accept: 'application/json' }
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`
  }

  // Get all devices for this user
  const url = API.url(`/user/${encodeURIComponent(username)}`)
  const res = await fetch(url, { headers })
  
  if (!res.ok) {
    throw new Error(`User not found: ${username}`)
  }

  const userData = await res.json()
  if (!userData?.devices || userData.devices.length === 0) {
    throw new Error('User has no registered devices')
  }

  // Encrypt for each device
  const encrypted = []
  for (const device of userData.devices) {
    try {
      const ciphertext = await encryptFor(device.deviceId, plaintext)
      encrypted.push({
        deviceId: device.deviceId,
        ciphertext
      })
    } catch (e) {
      console.warn(`Failed to encrypt for device ${device.deviceId}:`, e)
    }
  }

  if (encrypted.length === 0) {
    throw new Error('Failed to encrypt for any device')
  }

  return encrypted
}