// client-web/src/screens/DeviceManagement.tsx
import React, { useState, useEffect, useCallback } from 'react'
import DeviceSync from '../sync/DeviceSync'
import type { DeviceInfo, SyncProgress } from '../sync/types'

interface DeviceManagementProps {
  onClose?: () => void
}

export const DeviceManagement: React.FC<DeviceManagementProps> = ({ onClose }) => {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showQRLinking, setShowQRLinking] = useState(false)
  const [deviceSync] = useState(() => new DeviceSync())

  const loadDevices = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const deviceList = await deviceSync.getMyDevices()

      // Mark current device
      const currentDeviceId = localStorage.getItem('deviceId')
      const devicesWithCurrent = deviceList.map(device => ({
        ...device,
        current: device.id === currentDeviceId
      }))

      setDevices(devicesWithCurrent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices')
    } finally {
      setLoading(false)
    }
  }, [deviceSync])

  const handleRemoveDevice = async (deviceId: string) => {
    if (!confirm('Remove this device? This action cannot be undone.')) {
      return
    }

    try {
      await deviceSync.removeDevice(deviceId)
      setDevices(prev => prev.filter(d => d.id !== deviceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove device')
    }
  }

  const handleAddDevice = () => {
    setShowQRLinking(true)
  }

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  if (showQRLinking) {
    return (
      <QRLinking 
        onClose={() => setShowQRLinking(false)}
        onComplete={loadDevices}
        deviceSync={deviceSync}
      />
    )
  }

  return (
    <div className="device-management">
      <div className="header">
        <h2>Device Management</h2>
        <p>Manage your synchronized devices</p>
        {onClose && (
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading devices...</div>
      ) : (
        <>
          <div className="device-list">
            {devices.map(device => (
              <div key={device.id} className={`device-card ${device.current ? 'current' : ''}`}>
                <div className="device-info">
                  <div className="device-icon">
                    {device.isPrimary ? '👑' : '📱'}
                  </div>
                  <div className="device-details">
                    <h3>{device.deviceName || 'Unnamed Device'}</h3>
                    <div className="device-meta">
                      {device.current && <span className="current-badge">Current Device</span>}
                      {device.isPrimary && <span className="primary-badge">Primary</span>}
                      <span className="last-seen">
                        Last seen: {new Date(device.lastSeenAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="device-actions">
                  {!device.current && (
                    <button 
                      className="btn-danger btn-sm"
                      onClick={() => handleRemoveDevice(device.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="actions">
            <button className="btn-primary" onClick={handleAddDevice}>
              Add New Device
            </button>
            <button className="btn-outline" onClick={loadDevices}>
              Refresh
            </button>
          </div>
        </>
      )}
    </div>
  )
}

interface QRLinkingProps {
  onClose: () => void
  onComplete: () => void
  deviceSync: DeviceSync
}

const QRLinking: React.FC<QRLinkingProps> = ({ onClose, onComplete, deviceSync }) => {
  const [qrData, setQrData] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    // Set up progress callback
    deviceSync.setSyncProgressCallback(setSyncProgress)

    // Start linking process
    const startLinking = async () => {
      try {
        const qrCode = await deviceSync.startDeviceLinking()
        setQrData(qrCode)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start linking')
      }
    }

    startLinking()
  }, [deviceSync])

  const handleSimulateLink = async () => {
    if (!qrData) return

    try {
      // Simulate completing the linking process
      // In real implementation, this would happen when the QR is scanned
      await deviceSync.completeLinking('simulated_device_id')
      setIsComplete(true)

      setTimeout(() => {
        onComplete()
        onClose()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete linking')
    }
  }

  return (
    <div className="qr-linking">
      <div className="header">
        <h2>Add New Device</h2>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {qrData ? (
        <div className="qr-section">
          <div className="qr-code">
            {/* In real implementation, use a QR code library */}
            <div className="qr-placeholder">
              <div className="qr-pattern"></div>
              <p>QR Code</p>
            </div>
          </div>

          <div className="instructions">
            <h3>Link Your Device</h3>
            <ol>
              <li>Open GhostComms on your new device</li>
              <li>Go to Settings → Link Device</li>
              <li>Scan this QR code</li>
              <li>Wait for synchronization to complete</li>
            </ol>

            <button className="btn-primary" onClick={handleSimulateLink}>
              Simulate Device Link
            </button>
          </div>
        </div>
      ) : (
        <div className="loading">
          Generating secure QR code...
        </div>
      )}

      {syncProgress && (
        <div className="sync-progress">
          <h4>Synchronization Progress</h4>
          <div className="progress-item">
            <div className="progress-info">
              <strong>{syncProgress.stage}</strong>
              <p>{syncProgress.description}</p>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${syncProgress.progress}%` }}
              ></div>
            </div>
          </div>
          {isComplete && (
            <div className="success-message">
              ✅ Device linked successfully!
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DeviceManagement