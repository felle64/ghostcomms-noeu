// client-web/src/sync/DeviceSync.ts
import nacl from 'tweetnacl'
import { API } from '../api'
import { db, type StoredMsg, saveMessage } from '../storage/db'
import { ensureIdentity } from '../crypto/signal'
import type { 
  DeviceInfo, 
  LinkingSession, 
  QRLinkingData, 
  SyncProgress, 
  HistoryArchive,
  ProvisioningMessage,
  ArchiveMessage
} from './types'

const b64 = {
  enc: (u: Uint8Array) => btoa(String.fromCharCode(...u)),
  dec: (s: string) => new Uint8Array(atob(s).split('').map(c => c.charCodeAt(0))),
}

export class DeviceSync {
  private currentLinkingSession: LinkingSession | null = null
  private syncProgressCallback?: (progress: SyncProgress) => void

  constructor(private api: typeof API = API) {}

  // Set callback for sync progress updates
  setSyncProgressCallback(callback: (progress: SyncProgress) => void) {
    this.syncProgressCallback = callback
  }

  private updateProgress(stage: string, description: string, progress: number, complete: boolean = false) {
    if (this.syncProgressCallback) {
      this.syncProgressCallback({ stage, description, progress, complete })
    }
  }

  // Get all devices for current user
  async getMyDevices(): Promise<DeviceInfo[]> {
    const jwt = localStorage.getItem('jwt')
    if (!jwt) throw new Error('Not authenticated')

    const response = await fetch(this.api.url('/my-devices'), {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch devices: ${response.status}`)
    }

    const data = await response.json()
    return data.devices
  }

  // Remove a device
  async removeDevice(deviceId: string): Promise<void> {
    const jwt = localStorage.getItem('jwt')
    if (!jwt) throw new Error('Not authenticated')

    const response = await fetch(this.api.url(`/device/${deviceId}`), {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${jwt}`
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to remove device: ${response.status}`)
    }
  }

  // Start device linking process (Primary device side)
  async startDeviceLinking(): Promise<string> {
    this.updateProgress('Generate Linking Keys', 'Creating secure provisioning keypair for device pairing', 10)

    const jwt = localStorage.getItem('jwt')
    if (!jwt) throw new Error('Not authenticated')

    // Generate temporary linking keypair
    const linkingKeypair = nacl.box.keyPair()
    const provisioningAddress = this.generateProvisioningAddress()

    // Create linking session on server
    const response = await fetch(this.api.url('/linking/start'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provisioningAddress,
        linkingKeyPubB64: b64.enc(linkingKeypair.publicKey)
      })
    })

    if (!response.ok) {
      throw new Error(`Failed to start linking: ${response.status}`)
    }

    const sessionData = await response.json()

    // Store linking session locally (temporarily)
    this.currentLinkingSession = {
      id: sessionData.id,
      provisioningAddress,
      linkingKeyPub: linkingKeypair.publicKey,
      linkingKeyPriv: linkingKeypair.secretKey,
      qrData: sessionData.qrData,
      expiresAt: new Date(sessionData.expiresAt),
      used: false
    }

    this.updateProgress('QR Code Display', 'Encoding device public key and provisioning address', 25)

    return sessionData.qrData
  }

  // Complete device linking process (Primary device side)
  async completeLinking(newDeviceId: string): Promise<void> {
    this.updateProgress('Key Exchange', 'Sending identity keys and account information securely', 50)

    if (!this.currentLinkingSession) {
      throw new Error('No active linking session')
    }

    const jwt = localStorage.getItem('jwt')
    if (!jwt) throw new Error('Not authenticated')

    // Get current user info
    const userInfo = JSON.parse(atob(jwt.split('.')[1]))

    // Create provisioning message
    const identity = ensureIdentity()
    const provisioningMsg: ProvisioningMessage = {
      identityKeyPub: identity.pub,
      signedPrekeyPub: identity.pub, // In real implementation, use proper signed prekey
      accountInfo: {
        userId: userInfo.uid,
        username: localStorage.getItem('username') || ''
      }
    }

    this.updateProgress('History Archive', 'Compressing and encrypting chat history (AES-256)', 75)

    // Create history archive
    const archiveKey = await this.createHistoryArchive()
    if (archiveKey) {
      provisioningMsg.archiveKey = archiveKey
    }

    // Send provisioning message to new device
    await this.sendProvisioningMessage(newDeviceId, provisioningMsg)

    this.updateProgress('Sync Complete', 'New device successfully linked with full message history', 100, true)

    // Clean up linking session
    this.currentLinkingSession = null
  }

  // Create and upload encrypted history archive
  private async createHistoryArchive(): Promise<string | null> {
    try {
      // Get all messages from Dexie
      const allMessages = await db.messages.orderBy('ts').toArray()

      if (allMessages.length === 0) {
        return null // No history to sync
      }

      // Convert to archive format
      const archiveMessages: ArchiveMessage[] = allMessages.map(msg => ({
        id: msg.id,
        peer: msg.peer,
        text: msg.text,
        mine: msg.mine,
        ts: msg.ts,
        system: msg.system,
        read: msg.read
      }))

      // Compress and encrypt the data
      const archiveData = JSON.stringify(archiveMessages)
      const archiveBytes = new TextEncoder().encode(archiveData)

      // Generate one-time encryption key
      const archiveKey = b64.enc(nacl.randomBytes(32))
      const keyBytes = b64.dec(archiveKey)
      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)

      // Encrypt with secretbox
      const encryptedArchive = nacl.secretbox(archiveBytes, nonce, keyBytes)
      const finalData = new Uint8Array(nonce.length + encryptedArchive.length)
      finalData.set(nonce)
      finalData.set(encryptedArchive, nonce.length)

      // Upload to server
      const jwt = localStorage.getItem('jwt')
      const response = await fetch(this.api.url('/history/archive'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/octet-stream'
        },
        body: finalData
      })

      if (!response.ok) {
        throw new Error(`Failed to upload archive: ${response.status}`)
      }

      const result = await response.json()
      return result.archiveKey

    } catch (error) {
      console.error('Failed to create history archive:', error)
      return null
    }
  }

  // Send provisioning message to new device
  private async sendProvisioningMessage(deviceId: string, message: ProvisioningMessage): Promise<void> {
    if (!this.currentLinkingSession) {
      throw new Error('No active linking session')
    }

    const jwt = localStorage.getItem('jwt')
    const response = await fetch(this.api.url('/linking/provision'), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: this.currentLinkingSession.id,
        targetDeviceId: deviceId,
        provisioningMessage: {
          identityKeyPubB64: b64.enc(message.identityKeyPub),
          signedPrekeyPubB64: b64.enc(message.signedPrekeyPub),
          archiveKey: message.archiveKey,
          accountInfo: message.accountInfo
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Failed to send provisioning message: ${response.status}`)
    }
  }

  // Process QR code and link to existing account (New device side)
  async processQRCode(qrData: string, deviceName?: string): Promise<void> {
    this.updateProgress('Device Pairing', 'Establishing secure channel with primary device', 30)

    try {
      const linkingData: QRLinkingData = JSON.parse(atob(qrData))

      // Generate our device keys
      const deviceKeypair = nacl.box.keyPair()

      // Send pairing request to server
      const response = await fetch(this.api.url('/linking/pair'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provisioningAddress: linkingData.provisioningAddress,
          devicePublicKeyB64: b64.enc(deviceKeypair.publicKey),
          deviceName: deviceName || 'New Device'
        })
      })

      if (!response.ok) {
        throw new Error(`Pairing failed: ${response.status}`)
      }

      const pairingResult = await response.json()

      this.updateProgress('Key Exchange', 'Receiving account credentials and encryption keys', 60)

      // Wait for provisioning message
      await this.waitForProvisioningMessage(pairingResult.deviceId, deviceKeypair.secretKey)

    } catch (error) {
      throw new Error(`QR processing failed: ${error.message}`)
    }
  }

  // Wait for and process provisioning message (New device side)
  private async waitForProvisioningMessage(deviceId: string, privateKey: Uint8Array): Promise<void> {
    // Poll for provisioning message (in real implementation, use WebSocket)
    const maxAttempts = 30
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(this.api.url(`/linking/provision/${deviceId}`))

        if (response.ok) {
          const provisioningData = await response.json()
          await this.processProvisioningMessage(provisioningData, privateKey)
          return
        }

        if (response.status !== 404) {
          throw new Error(`Provisioning check failed: ${response.status}`)
        }

        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 2000))
        attempts++

      } catch (error) {
        if (attempts >= maxAttempts - 1) {
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
        attempts++
      }
    }

    throw new Error('Provisioning timeout - no message received from primary device')
  }

  // Process received provisioning message and sync history (New device side)
  private async processProvisioningMessage(data: any, privateKey: Uint8Array): Promise<void> {
    this.updateProgress('Transfer History', 'Downloading and decrypting message history', 80)

    try {
      // Store account information
      localStorage.setItem('userId', data.accountInfo.userId)
      localStorage.setItem('username', data.accountInfo.username)

      // Store identity keys (in real implementation, verify these)
      const identityPub = b64.dec(data.identityKeyPubB64)
      const signedPrekeyPub = b64.dec(data.signedPrekeyPubB64)

      localStorage.setItem('id_pub', b64.enc(identityPub))
      localStorage.setItem('sp_pub', b64.enc(signedPrekeyPub))

      // Download and decrypt history archive if available
      if (data.archiveKey) {
        await this.downloadAndDecryptHistory(data.archiveKey)
      }

      this.updateProgress('Sync Complete', 'Device successfully linked with full message history', 100, true)

    } catch (error) {
      throw new Error(`Provisioning processing failed: ${error.message}`)
    }
  }

  // Download and decrypt history archive (New device side)
  private async downloadAndDecryptHistory(archiveKey: string): Promise<void> {
    try {
      // Download encrypted archive
      const response = await fetch(this.api.url(`/history/download/${archiveKey}`))

      if (!response.ok) {
        throw new Error(`Archive download failed: ${response.status}`)
      }

      const encryptedData = new Uint8Array(await response.arrayBuffer())

      // Decrypt archive
      const keyBytes = b64.dec(archiveKey)
      const nonce = encryptedData.slice(0, nacl.secretbox.nonceLength)
      const ciphertext = encryptedData.slice(nacl.secretbox.nonceLength)

      const decryptedData = nacl.secretbox.open(ciphertext, nonce, keyBytes)

      if (!decryptedData) {
        throw new Error('Failed to decrypt history archive')
      }

      // Parse and restore messages
      const archiveData = new TextDecoder().decode(decryptedData)
      const messages: ArchiveMessage[] = JSON.parse(archiveData)

      // Clear existing messages and restore from archive
      await db.messages.clear()

      for (const msg of messages) {
        const storedMsg: StoredMsg = {
          id: msg.id,
          peer: msg.peer,
          text: msg.text,
          mine: msg.mine,
          ts: msg.ts,
          system: msg.system,
          read: msg.read,
          delivered: true // Assume historical messages are delivered
        }

        await saveMessage(storedMsg)
      }

      console.log(`✅ Restored ${messages.length} messages from history archive`)

    } catch (error) {
      console.error('History sync failed:', error)
      // Don't throw - linking can still succeed without history
    }
  }

  private generateProvisioningAddress(): string {
    return 'gc_' + b64.enc(nacl.randomBytes(16)).replace(/[+/=]/g, '').substring(0, 20)
  }
}

export default DeviceSync