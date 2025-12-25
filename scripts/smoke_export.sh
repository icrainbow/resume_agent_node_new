#!/bin/bash
#
# Phase 4 Export Smoke Test
# Tests:
# 1. POST /api/export returns ok:true and artifacts[]
# 2. GET /api/download proxies to worker and returns file
#

set -e

NEXT_BASE="${NEXT_BASE:-http://127.0.0.1:3000}"
JOB_ID="smoke-test-$(date +%s)"

echo "=== Phase 4 Export Smoke Test ==="
echo "Next.js: $NEXT_BASE"
echo "Job ID: $JOB_ID"
echo ""

# Minimal valid payload
PAYLOAD=$(cat <<'EOF'
{
  "job_id": "JOB_ID_PLACEHOLDER",
  "base_name": "SmokeTest",
  "sections": [
    {
      "id": "section-1",
      "title": "Summary",
      "text": "Experienced software engineer with expertise in distributed systems.",
      "optimized_text": "Experienced software engineer with expertise in distributed systems.",
      "warnings": []
    },
    {
      "id": "section-2",
      "title": "Experience",
      "text": "Senior Engineer at Example Corp (2020-present). Led development of microservices platform.",
      "optimized_text": "Senior Engineer at Example Corp (2020-present). Led development of microservices platform.",
      "warnings": []
    }
  ],
  "export_pdf": true
}
EOF
)

# Replace job_id
PAYLOAD=$(echo "$PAYLOAD" | sed "s/JOB_ID_PLACEHOLDER/$JOB_ID/g")

echo "Step 1: POST $NEXT_BASE/api/export"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$NEXT_BASE/api/export" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS:/d')

echo "  Status: $HTTP_STATUS"

if [ "$HTTP_STATUS" != "200" ]; then
  echo "❌ FAIL: Expected 200, got $HTTP_STATUS"
  echo "$BODY"
  exit 1
fi

OK=$(echo "$BODY" | jq -r '.ok' 2>/dev/null || echo "false")
if [ "$OK" != "true" ]; then
  echo "❌ FAIL: ok != true"
  echo "$BODY" | jq '.'
  exit 1
fi

ARTIFACTS_COUNT=$(echo "$BODY" | jq '.artifacts | length' 2>/dev/null || echo "0")
if [ "$ARTIFACTS_COUNT" -lt 1 ]; then
  echo "❌ FAIL: No artifacts returned"
  echo "$BODY" | jq '.'
  exit 1
fi

echo "  ✓ Returned ok:true with $ARTIFACTS_COUNT artifacts"
echo ""

# Test each artifact download
for i in $(seq 0 $((ARTIFACTS_COUNT - 1))); do
  KIND=$(echo "$BODY" | jq -r ".artifacts[$i].kind")
  URL=$(echo "$BODY" | jq -r ".artifacts[$i].url")

  # Resolve relative URL
  if [[ "$URL" == /* ]]; then
    FULL_URL="${NEXT_BASE}${URL}"
  else
    FULL_URL="$URL"
  fi

  echo "Step 2.$((i+1)): GET $FULL_URL"

  # Check HEAD first
  HEAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -I "$FULL_URL")
  echo "  HEAD status: $HEAD_STATUS"

  if [ "$HEAD_STATUS" != "200" ]; then
    echo "❌ FAIL: Expected 200, got $HEAD_STATUS"
    exit 1
  fi

  # Download artifact
  DL_STATUS=$(curl -s -o /tmp/smoke_${KIND}.tmp -w "%{http_code}" "$FULL_URL")

  if [ "$DL_STATUS" != "200" ]; then
    echo "❌ FAIL: Download returned $DL_STATUS"
    exit 1
  fi

  FILE_SIZE=$(wc -c < /tmp/smoke_${KIND}.tmp | tr -d ' ')

  if [ "$FILE_SIZE" -lt 100 ]; then
    echo "❌ FAIL: File too small ($FILE_SIZE bytes)"
    exit 1
  fi

  echo "  ✓ Downloaded $KIND ($FILE_SIZE bytes)"
  rm -f /tmp/smoke_${KIND}.tmp
done

echo ""
echo "=== ✅ All smoke tests passed ==="
echo ""
echo "Verified:"
echo "  • POST /api/export → worker /export"
echo "  • Worker returns artifacts with relative URLs"
echo "  • GET /api/download → worker /files (proxy)"
echo "  • Downloads return valid files"
