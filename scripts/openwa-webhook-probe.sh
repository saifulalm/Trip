#!/usr/bin/env bash
# Simulasi delivery webhook OpenWA dari WSL ke backend Windows.
# Dipakai untuk verifikasi jaringan + HMAC end-to-end.
set -euo pipefail

SECRET="${OPENWA_WEBHOOK_SECRET:-sabesi-openwa-webhook-secret-2026}"
URL="${OPENWA_WEBHOOK_URL:-http://172.18.112.1:4100/api/webhooks/openwa}"
KEY="${1:-wsl-uji-$(date +%s)}"
BODY='{"event":"message.received","sessionId":"715a84d6-c490-47aa-86c1-5010cfa235e7","data":{"from":"628123456789@c.us","chatId":"628123456789@c.us","body":"uji delivery dari WSL","type":"text","fromMe":false,"isGroup":false}}'

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
echo "url=$URL"
echo "sig=sha256=$SIG"
echo "key=$KEY"

curl -s -m 10 -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "X-OpenWA-Signature: sha256=$SIG" \
  -H 'X-OpenWA-Event: message.received' \
  -H "X-OpenWA-Idempotency-Key: $KEY" \
  --data-binary "$BODY"
echo
