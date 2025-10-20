# Security Fixes Implementation Plan

## Executive Summary
This document provides a detailed, step-by-step plan to address 22 identified security, configuration, and code quality issues in the GhostComms NoEU project.

---

## Phase 1: CRITICAL Security Fixes (Deploy Blockers)

### 1.1 Remove Secrets from Git History

**Issue**: JWT secrets and credentials tracked in git repository

**Files to Remove**:
- `server/.env.local`
- `client-web/.env.local`
- `client-web/.env.production`

**Steps**:
```bash
# Remove from git tracking (keep local files)
git rm --cached server/.env.local
git rm --cached client-web/.env.local
git rm --cached client-web/.env.production

# For complete security, remove from git history:
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch server/.env.local client-web/.env.local client-web/.env.production' \
  --prune-empty --tag-name-filter cat -- --all

# Force push (CAUTION: coordinate with team)
git push origin --force --all
```

**Post-Cleanup**:
1. Rotate all exposed secrets immediately
2. Generate new JWT_SECRET (64+ character random string)
3. Create new Cloudflare tunnel token
4. Update production deployments

---

### 1.2 Fix Docker Compose Secrets

**File**: `docker-compose.yml`

**Current Issues**:
- Line 42: Hardcoded JWT_SECRET
- Line 90: Exposed Cloudflare tunnel token

**Fix**:
```yaml
# Remove hardcoded values, use environment variables
server:
  environment:
    JWT_SECRET: ${JWT_SECRET}  # Load from .env file or environment

cloudflared:
  environment:
    TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}  # Load from environment
  command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
```

**Create `.env` template**:
```bash
# .env.example (commit this)
JWT_SECRET=
CLOUDFLARE_TUNNEL_TOKEN=
DATABASE_PASSWORD=

# .env (add to .gitignore, don't commit)
JWT_SECRET=<generate-with: openssl rand -hex 64>
CLOUDFLARE_TUNNEL_TOKEN=<your-token>
DATABASE_PASSWORD=<secure-password>
```

---

### 1.3 Add JWT_SECRET Validation

**File**: `server/src/env.ts`

**Current Code**:
```typescript
export const JWT_SECRET = process.env.JWT_SECRET!
```

**Fixed Code**:
```typescript
import dotenv from 'dotenv'
dotenv.config()

export const PORT = Number(process.env.PORT || 8080)

// Validate JWT_SECRET
const JWT_SECRET_RAW = process.env.JWT_SECRET
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.trim().length < 32) {
  throw new Error(
    'JWT_SECRET must be set in environment and be at least 32 characters long. ' +
    'Generate one with: openssl rand -hex 64'
  )
}
export const JWT_SECRET = JWT_SECRET_RAW.trim()

export const REGION = process.env.REGION || 'CH'
export const EPHEMERAL_TTL_SECONDS = Number(process.env.EPHEMERAL_TTL_SECONDS || 86400)

// Validate database URL
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in environment')
}
```

---

### 1.4 Fix Misleading Security Claim

**File**: `client-web/src/screens/Login.tsx`

**Line 232**: Incorrect claim about client-side password hashing

**Option A - Update UI Text** (Recommended for MVP):
```typescript
<strong>Privacy Notice:</strong> Your password is hashed on the server with PBKDF2 (100,000 iterations).
Messages are end-to-end encrypted with NaCl. Use HTTPS connections only. No phone number required.
```

**Option B - Implement Client-Side Hashing** (Better Security):
```typescript
// Add to crypto/signal.ts
import { pbkdf2 } from 'crypto'

export async function hashPasswordClient(password: string, username: string): Promise<string> {
  const encoder = new TextEncoder()
  const passwordData = encoder.encode(password)
  const salt = encoder.encode(username.toLowerCase()) // Username as salt

  const key = await crypto.subtle.importKey(
    'raw',
    passwordData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-512'
    },
    key,
    512
  )

  return btoa(String.fromCharCode(...new Uint8Array(derivedBits)))
}

// Update Login.tsx to hash before sending
const hashedPassword = await hashPasswordClient(password, username)
// Send hashedPassword instead of password
```

---

### 1.5 Update .gitignore

**File**: `.gitignore`

**Add**:
```gitignore
# Node and general ignores
node_modules/
dist/
build/
.DS_Store

# Environment files
.env
.env.local
.env.*.local
.env.production
.env.development
.env.test
*.env
!.env.example

# Secrets directory
secrets/
*.secret
*.key
*.pem

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
*.log
*.tmp

# Database
*.db
*.sqlite
*.sqlite3

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
```

---

## Phase 2: HIGH Priority Security Fixes

### 2.1 Add WebSocket Rate Limiting

**File**: `server/src/ws.ts`

**Implementation**:
```typescript
// Add at top of file
type RateLimitEntry = {
  count: number
  resetAt: number
}

const MESSAGE_RATE_LIMIT = 50 // messages per window
const RATE_WINDOW_MS = 60000 // 1 minute
const wsRateLimits = new Map<string, RateLimitEntry>()

function checkRateLimit(deviceId: string): boolean {
  const now = Date.now()
  const entry = wsRateLimits.get(deviceId)

  if (!entry || now > entry.resetAt) {
    wsRateLimits.set(deviceId, {
      count: 1,
      resetAt: now + RATE_WINDOW_MS
    })
    return true
  }

  if (entry.count >= MESSAGE_RATE_LIMIT) {
    return false
  }

  entry.count++
  return true
}

// In ws.on('message') handler, add after line 80:
ws.on('message', async (raw) => {
  // Rate limit check
  if (!checkRateLimit(did)) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'RATE_LIMIT',
      message: 'Too many messages, please slow down'
    }))
    return
  }

  // ... rest of existing code
})

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [deviceId, entry] of wsRateLimits.entries()) {
    if (now > entry.resetAt) {
      wsRateLimits.delete(deviceId)
    }
  }
}, 60000)
```

---

### 2.2 Fix Cryptographic Key Reuse

**File**: `client-web/src/crypto/signal.ts`

**Add New Functions**:
```typescript
// Generate signed prekey (separate from identity key)
export function ensureSignedPrekey(): { pub: Uint8Array, sec: Uint8Array } {
  let pub = LS.get('spk_pub'), sec = LS.get('spk_sec')
  if (!pub || !sec) {
    const kp = nacl.box.keyPair()
    pub = Uint8Array.from(kp.publicKey)
    sec = Uint8Array.from(kp.secretKey)
    if (pub && sec) {
      LS.set('spk_pub', pub)
      LS.set('spk_sec', sec)
    }
  }
  if (!pub || !sec) {
    throw new Error('Failed to generate signed prekey')
  }
  return { pub, sec }
}

export function mySignedPrekeyPubB64(): string {
  const pub = ensureSignedPrekey().pub
  if (!pub) {
    throw new Error("Signed prekey public key is null")
  }
  return b64.enc(pub)
}

// Generate one-time prekeys
export function generateOneTimePrekeys(count: number = 10): string[] {
  const prekeys: string[] = []
  for (let i = 0; i < count; i++) {
    const kp = nacl.box.keyPair()
    prekeys.push(b64.enc(kp.publicKey))
  }
  return prekeys
}
```

**Update**: `client-web/src/screens/Login.tsx`
```typescript
// Line 28-40, replace with:
const idPub = myIdentityPubB64()
const spPub = mySignedPrekeyPubB64()
const otks = generateOneTimePrekeys(10)

const res = await fetch(API.url(endpoint), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: username.toLowerCase().trim(),
    password,
    deviceName: deviceName || undefined,
    identityKeyPubB64: idPub,
    signedPrekeyPubB64: spPub,
    oneTimePrekeysB64: otks
  })
})
```

---

### 2.3 Configure Database Connection Pool

**File**: `server/src/index.ts`

**Update**:
```typescript
async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    },
    // Add connection pool configuration
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

  // Configure connection pool via DATABASE_URL
  // Example: postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=20

  const app = await createApp()
  await registerHttpRoutes(app, prisma)
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`GhostComms • NoEU relay on :${PORT}`)
  attachWs(app, prisma)

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing connections...')
    await prisma.$disconnect()
    await app.close()
    process.exit(0)
  })
}
```

**Update DATABASE_URL format**:
```
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=20&connect_timeout=10"
```

---

## Phase 3: MEDIUM Priority Fixes

### 3.1 Fix Dependency Vulnerabilities

```bash
# Server
cd server
npm audit fix
npm update fast-redact pino

# Client
cd ../client-web
npm audit fix
npm update vite
```

**Verify versions**:
- `vite` should be >= 7.1.11
- `fast-redact` should be >= 3.5.1
- `pino` should be >= 9.11.1

---

### 3.2 Fix Error Handling

**File**: `server/src/ws.ts`

**Replace silent catches**:
```typescript
// Line 48-51 (lastSeenAt update)
prisma.device.update({
  where: { id: did },
  data: { lastSeenAt: new Date() }
}).catch((err) => {
  console.error('Failed to update lastSeenAt for device', did, err)
})

// Line 78 (backlog delivery)
})().catch((err) => {
  console.error('Failed to send backlog for device', did, err)
})
```

**File**: `client-web/src/screens/thread/useThread.ts`

**Line 286**:
```typescript
sendControl(ws, peerDid, payload).catch((err) => {
  console.error('Failed to send control message:', err)
})
```

---

### 3.3 Enable Structured Logging

**File**: `server/src/createApp.ts`

**Update line 16**:
```typescript
export async function createApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'production' ? {
      level: 'info',
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          headers: req.headers,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
    } : true  // Pretty print in development
  })
  // ... rest
}
```

**Replace console.log/error with logger**:
```typescript
// ws.ts - replace console.log with app.log.info
// routes.ts - use reply.log.error for errors
```

---

### 3.4 Add Input Validation for Device Names

**File**: `server/src/routes.ts`

**Add validation function**:
```typescript
function validateDeviceName(name: string | undefined): string {
  if (!name) return 'Device'
  const sanitized = name.trim().slice(0, 50) // Max 50 chars
  return sanitized.replace(/[<>]/g, '') // Remove potential HTML
}

// Update lines 104 and 186:
deviceName: validateDeviceName(b.deviceName) || 'Device 1',
deviceName: validateDeviceName(b.deviceName) || `Device ${deviceCount + 1}`,
```

---

## Phase 4: LOW Priority Fixes

### 4.1 Enable Content Security Policy

**File**: `server/src/createApp.ts`

**Update helmet config**:
```typescript
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  global: true,
})
```

---

### 4.2 Add Database Indices

**File**: `server/prisma/schema.prisma`

**Update Envelope model (line 80)**:
```prisma
model Envelope {
  id           String    @id @default(cuid())
  fromDeviceId String
  toUserId     String
  toDeviceId   String?
  ciphertext   Bytes
  contentType  String
  createdAt    DateTime  @default(now())
  deliveredAt  DateTime?
  expiresAt    DateTime

  @@index([toUserId, createdAt])
  @@index([toDeviceId, createdAt])
  @@index([fromDeviceId])           // NEW INDEX
  @@index([expiresAt])               // NEW INDEX for cleanup job
}
```

**Apply migration**:
```bash
cd server
npx prisma db push
```

---

### 4.3 Create Envelope Cleanup Job

**New File**: `server/src/jobs/cleanupExpiredEnvelopes.ts`

```typescript
import { PrismaClient } from '@prisma/client'

export async function cleanupExpiredEnvelopes(prisma: PrismaClient) {
  const result = await prisma.envelope.deleteMany({
    where: {
      expiresAt: {
        lt: new Date()
      }
    }
  })

  console.log(`Cleaned up ${result.count} expired envelopes`)
  return result.count
}

// Run standalone
if (require.main === module) {
  const prisma = new PrismaClient()
  cleanupExpiredEnvelopes(prisma)
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error('Cleanup failed:', err)
      process.exit(1)
    })
}
```

**Update**: `server/src/index.ts`

```typescript
import { cleanupExpiredEnvelopes } from './jobs/cleanupExpiredEnvelopes'

async function main() {
  // ... existing setup

  // Run cleanup every hour
  setInterval(() => {
    cleanupExpiredEnvelopes(prisma).catch((err) => {
      console.error('Envelope cleanup error:', err)
    })
  }, 3600000) // 1 hour
}
```

**Add to package.json**:
```json
"scripts": {
  "cleanup": "tsx src/jobs/cleanupExpiredEnvelopes.ts"
}
```

**Cron job for production** (crontab):
```bash
0 * * * * cd /path/to/server && npm run cleanup
```

---

### 4.4 Add Type Safety

**File**: `server/src/routes.ts`

**Replace `as any` casts**:
```typescript
// Define route parameter types
interface UsernameParams {
  username: string
}

interface DeviceIdParams {
  deviceId: string
}

interface WhoParams {
  who: string
}

// Update route handlers:
app.get<{ Params: WhoParams }>('/resolve/:who', async (req, reply) => {
  const who = req.params.who || ''
  // ...
})

app.get<{ Params: UsernameParams }>('/user/:username', async (req, reply) => {
  const username = req.params.username.toLowerCase()
  // ...
})

app.delete<{ Params: DeviceIdParams }>('/device/:deviceId', async (req, reply) => {
  const targetId = req.params.deviceId
  // ...
})
```

---

### 4.5 Add React Error Boundary

**New File**: `client-web/src/ErrorBoundary.tsx`

```typescript
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('React Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          textAlign: 'center',
          color: 'var(--muted)'
        }}>
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>
            Reload App
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

**Update**: `client-web/src/main.tsx`

```typescript
import { ErrorBoundary } from './ErrorBoundary'

root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
```

---

## Phase 5: Testing & CI

### 5.1 Add Basic Test Suite

**Install dependencies**:
```bash
cd server
npm install --save-dev vitest @vitest/ui

cd ../client-web
npm install --save-dev vitest @vitest/ui @testing-library/react jsdom
```

**Server Test**: `server/src/crypto.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { hashPassword, generateSalt, verifyPassword } from './crypto'

describe('crypto', () => {
  it('should hash and verify password correctly', () => {
    const password = 'test123456'
    const salt = generateSalt()
    const hash = hashPassword(password, salt)

    expect(verifyPassword(password, salt, hash)).toBe(true)
    expect(verifyPassword('wrong', salt, hash)).toBe(false)
  })

  it('should generate unique salts', () => {
    const salt1 = generateSalt()
    const salt2 = generateSalt()
    expect(salt1).not.toBe(salt2)
  })
})
```

**Update**: `server/package.json`

```json
"scripts": {
  "test": "vitest",
  "test:ci": "vitest run"
}
```

**Update**: `.github/workflows/ci.yml`

```yaml
- name: Server tests
  working-directory: server
  run: |
    npm ci
    npx prisma generate
    npx prisma db push
    npm run test:ci
    npx tsc --noEmit
```

---

## Implementation Checklist

### Immediate (Before Next Deploy)
- [ ] Remove secrets from git (1.1)
- [ ] Fix docker-compose secrets (1.2)
- [ ] Add JWT validation (1.3)
- [ ] Fix password hashing claim (1.4)
- [ ] Update .gitignore (1.5)
- [ ] Update dependencies (3.1)

### High Priority (This Sprint)
- [ ] Add WebSocket rate limiting (2.1)
- [ ] Fix crypto key reuse (2.2)
- [ ] Configure DB connection pool (2.3)
- [ ] Fix error handling (3.2)

### Medium Priority (Next Sprint)
- [ ] Enable structured logging (3.3)
- [ ] Add input validation (3.4)
- [ ] Enable CSP (4.1)
- [ ] Add database indices (4.2)
- [ ] Create cleanup job (4.3)

### Low Priority (Technical Debt)
- [ ] Add type safety (4.4)
- [ ] Add error boundary (4.5)
- [ ] Set up testing (5.1)
- [ ] Improve commit messages

---

## Post-Implementation Verification

### Security Checklist
```bash
# 1. Verify no secrets in git
git log --all --full-history -- "*.env*" "secrets/*"

# 2. Test authentication
curl http://localhost:8080/health

# 3. Verify rate limiting
# Send 51 messages in < 1 min, should get rate limited

# 4. Check dependencies
npm audit

# 5. Verify JWT validation
# Try starting server without JWT_SECRET, should fail
```

### Performance Tests
```bash
# Load test WebSocket connections
# Use artillery or similar tool
```

---

## Rollback Plan

If issues occur after deployment:

1. **Revert git commits**: `git revert <commit-hash>`
2. **Restore old secrets**: Use backup environment variables
3. **Database rollback**: `npx prisma migrate dev` (if schema changed)
4. **Monitor logs**: Check for new errors

---

## Contact & Support

For questions about this fix plan:
- Review GitHub Issues
- Check documentation in `/docs`
- Contact security team

**Last Updated**: 2025-10-20
**Version**: 1.0
