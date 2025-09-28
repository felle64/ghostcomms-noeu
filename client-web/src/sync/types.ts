// types/sync.ts
export interface LinkingSession {
  id: string
  provisioningAddress: string
  linkingKeyPub: Uint8Array
  linkingKeyPriv: Uint8Array
  qrData: string
  expiresAt: Date
  used: boolean
}

export interface DeviceInfo {
  id: string
  deviceName?: string
  identityKeyPubB64: string
  lastSeenAt: string
  isPrimary: boolean
  current?: boolean
}

export interface HistoryArchive {
  id: string
  archiveKey: string
  encryptedData: Uint8Array
  size: number
  messageCount: number
  expiresAt: Date
}

export interface QRLinkingData {
  provisioningAddress: string
  devicePublicKey: string
  timestamp: number
  version: number
}

export interface SyncProgress {
  stage: string
  description: string
  progress: number
  complete: boolean
}

export interface ArchiveMessage {
  id: string
  peer: string
  text: string
  mine: boolean
  ts: number
  system?: boolean
  read?: boolean
}

export interface ProvisioningMessage {
  identityKeyPub: Uint8Array
  signedPrekeyPub: Uint8Array
  oneTimePrekeys?: Uint8Array[]
  archiveKey?: string
  deviceName?: string
  accountInfo: {
    userId: string
    username: string
  }
}