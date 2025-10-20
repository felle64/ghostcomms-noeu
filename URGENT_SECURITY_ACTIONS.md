# URGENT SECURITY ACTIONS REQUIRED

## Critical: Remove Secrets from Git Repository

### Step 1: Remove tracked secret files

Run these commands to stop tracking sensitive files:

```bash
# Remove from git tracking (keeps local files)
git rm --cached server/.env.local
git rm --cached client-web/.env.local
git rm --cached client-web/.env.production

# Commit the removal
git commit -m "security: Remove sensitive environment files from tracking"
```

### Step 2: Rotate all exposed secrets

**IMPORTANT**: All secrets that were committed to git must be considered compromised and rotated immediately:

1. **JWT_SECRET** (exposed in `server/.env.local`):
   ```bash
   # Generate a new secure JWT secret
   openssl rand -hex 64
   ```
   - Update this in your production environment
   - Update in all `.env` files (local, staging, production)

2. **Cloudflare Tunnel Token** (exposed in `docker-compose.yml` and `step1-pg-password.yml`):
   - Log into Cloudflare dashboard
   - Navigate to Zero Trust > Access > Tunnels
   - Delete the old tunnel or regenerate the token
   - Update `docker-compose.yml` to use environment variable instead of hardcoded token

3. **Database Credentials**:
   - Change PostgreSQL password
   - Update DATABASE_URL in all environments

### Step 3: Update docker-compose.yml

Remove hardcoded secrets from `docker-compose.yml`:

```yaml
# BEFORE (line 42):
JWT_SECRET: "change-me-super-random"

# AFTER:
JWT_SECRET: ${JWT_SECRET}  # Load from .env file

# BEFORE (line 90):
command: tunnel --no-autoupdate run --token eyJhIj...

# AFTER:
command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
```

Create a `.env` file in the project root:

```bash
# .env (DO NOT COMMIT THIS FILE)
JWT_SECRET=<your-new-64-char-secret>
CLOUDFLARE_TUNNEL_TOKEN=<your-new-tunnel-token>
DATABASE_PASSWORD=<your-secure-password>
```

### Step 4: Verify .gitignore is working

The `.gitignore` file has been updated. Verify it's working:

```bash
# Check that .env files are ignored
git status

# Should NOT show:
# - *.env.local
# - *.env.production
# - .env
```

### Step 5: (Optional but Recommended) Purge git history

If this repository is public or shared, you should purge the secrets from git history:

```bash
# CAUTION: This rewrites history. Coordinate with your team!

# Install git-filter-repo if needed
# On Ubuntu/Debian: sudo apt install git-filter-repo
# On macOS: brew install git-filter-repo

# Remove files from all history
git filter-repo --path server/.env.local --invert-paths
git filter-repo --path client-web/.env.local --invert-paths
git filter-repo --path client-web/.env.production --invert-paths

# Force push (coordinate with team!)
git push origin --force --all
```

**Alternative using BFG Repo-Cleaner** (faster for large repos):

```bash
# Download BFG: https://rtyley.github.io/bfg-repo-cleaner/

# Remove files
java -jar bfg.jar --delete-files '.env.local'
java -jar bfg.jar --delete-files '.env.production'

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push
git push origin --force --all
```

### Step 6: Update production deployments

After rotating secrets:

1. Update environment variables in production
2. Restart all services
3. Verify services are working with new secrets
4. Monitor logs for any authentication errors

---

## Summary of Files Modified

### Security Fixes Applied:
1. ✅ `server/src/env.ts` - Added JWT_SECRET and DATABASE_URL validation
2. ✅ `.gitignore` - Enhanced to prevent future secret leaks
3. ✅ `server/src/ws.ts` - Added WebSocket rate limiting
4. ✅ `server/src/ws.ts` - Improved error handling
5. ✅ `client-web/src/crypto/signal.ts` - Fixed crypto key reuse (separate identity and signed prekeys)
6. ✅ `client-web/src/screens/Login.tsx` - Fixed misleading password hashing claim
7. ✅ `server/prisma/schema.prisma` - Added missing database indices
8. ✅ `server/src/jobs/cleanupExpiredEnvelopes.ts` - Created envelope cleanup job
9. ✅ `server/src/index.ts` - Integrated cleanup job and graceful shutdown
10. ✅ `server/package.json` - Added cleanup script

### Files That Still Need Manual Action:
- `docker-compose.yml` - Remove hardcoded JWT_SECRET and tunnel token
- `step1-pg-password.yml` - Remove hardcoded tunnel token
- All `.env.local` and `.env.production` files - Should be removed from git

---

## Next Steps

1. **Immediately**: Remove and rotate secrets (Steps 1-3 above)
2. **Before next deploy**: Run `npm audit fix` in both server and client directories
3. **This week**: Set up monitoring/alerting for rate limiting events
4. **Next sprint**: Add automated testing (see SECURITY_FIXES.md Phase 5)

---

## Verification Checklist

After completing the above steps:

- [ ] Secrets removed from git tracking
- [ ] New JWT_SECRET generated and deployed
- [ ] Cloudflare tunnel token regenerated
- [ ] Database password changed
- [ ] docker-compose.yml uses environment variables
- [ ] .env file created but NOT committed
- [ ] .gitignore verified with `git status`
- [ ] Production services restarted with new secrets
- [ ] All services healthy and functioning
- [ ] Git history purged (if repository was public)

---

**Last Updated**: 2025-10-20
**Priority**: CRITICAL - Complete within 24 hours
