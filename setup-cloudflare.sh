#!/bin/bash
set -e

echo "🔐 Setting up Cloudflare Tunnel Secrets"
echo "========================================"

# Create secrets directory
mkdir -p secrets

# Check if tunnel token is provided as argument
if [ -z "$1" ]; then
    echo ""
    echo "⚠️  No tunnel token provided!"
    echo ""
    echo "To get your tunnel token:"
    echo "1. Go to https://one.dash.cloudflare.com/"
    echo "2. Navigate to Zero Trust → Access → Tunnels"
    echo "3. Create a new tunnel or select existing one"
    echo "4. Click on the tunnel name"
    echo "5. Go to 'Configure' tab"
    echo "6. Copy the token from the command shown"
    echo "   (it starts with 'eyJ...')"
    echo ""
    echo "Usage: ./setup-cloudflare.sh YOUR_TUNNEL_TOKEN"
    echo ""
    read -p "Paste your tunnel token here: " TUNNEL_TOKEN
else
    TUNNEL_TOKEN="$1"
fi

# Validate token format (should start with eyJ)
if [[ ! "$TUNNEL_TOKEN" =~ ^eyJ ]]; then
    echo "❌ Invalid token format. Cloudflare tokens start with 'eyJ'"
    exit 1
fi

# Write tunnel token to file (no newline!)
echo -n "$TUNNEL_TOKEN" > secrets/cf_tunnel_token.txt
chmod 600 secrets/cf_tunnel_token.txt

echo "✅ Tunnel token saved to secrets/cf_tunnel_token.txt"

# Check if database password exists, create if not
if [ ! -f secrets/pg_password.txt ]; then
    echo "📝 Creating database password..."
    # Generate a secure password (alphanumeric only)
    DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    echo -n "$DB_PASSWORD" > secrets/pg_password.txt
    chmod 600 secrets/pg_password.txt
    echo "✅ Database password created"
else
    echo "✅ Database password already exists"
fi

# Verify files
echo ""
echo "📋 Verifying secret files:"
echo "   cf_tunnel_token.txt: $(wc -c < secrets/cf_tunnel_token.txt) bytes"
echo "   pg_password.txt: $(wc -c < secrets/pg_password.txt) bytes"

# Test token format
echo ""
echo "🔍 Token validation:"
if [[ $(cat secrets/cf_tunnel_token.txt) =~ ^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+ ]]; then
    echo "   ✅ Token format looks valid (JWT format)"
else
    echo "   ⚠️  Token format might be invalid"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Start the services:"
echo "   docker compose up -d"
echo ""
echo "2. Configure your tunnel in Cloudflare dashboard:"
echo "   - app.nfktech.com → http://web:80"
echo "   - api.nfktech.com → http://server:8080"
echo "   - api.nfktech.com/ws → http://server:8080 (WebSocket enabled)"
echo ""
echo "3. Check logs:"
echo "   docker compose logs -f cloudflared"