#!/usr/bin/env zsh
set -euo pipefail

cd "$(dirname "$0")/.."

EXPECTED_ACCOUNT="kal@ybkarnold.com"
EXPECTED_PROJECT="ybkarnold-b7ec0"
SERVICE_NAME="arnold-quote-converter"
REGION="us-central1"

CURRENT_ACCOUNT="$(gcloud config get-value account 2>/dev/null)"
CURRENT_PROJECT="$(gcloud config get-value project 2>/dev/null)"

if [[ "$CURRENT_ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo "Wrong Google Cloud account: $CURRENT_ACCOUNT"
  echo "Expected: $EXPECTED_ACCOUNT"
  exit 1
fi

if [[ "$CURRENT_PROJECT" != "$EXPECTED_PROJECT" ]]; then
  echo "Wrong Google Cloud project: $CURRENT_PROJECT"
  echo "Expected: $EXPECTED_PROJECT"
  exit 1
fi

echo "Deploying $SERVICE_NAME as $CURRENT_ACCOUNT to $CURRENT_PROJECT..."
CONVERTER_TOKEN="$(openssl rand -hex 32)"

gcloud run deploy "$SERVICE_NAME" \
  --source ./quote-converter \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 3 \
  --set-env-vars "CONVERSION_TOKEN=$CONVERTER_TOKEN"

CONVERTER_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format='value(status.url)')"

if [[ -z "$CONVERTER_URL" ]]; then
  echo "Deployment finished without a service URL."
  exit 1
fi

cp functions/.env /tmp/arnold-functions.env.before-quote-converter
sed -i '' '/^QUOTE_CONVERTER_URL=/d; /^QUOTE_CONVERTER_TOKEN=/d' functions/.env
printf '\nQUOTE_CONVERTER_URL=%s\nQUOTE_CONVERTER_TOKEN=%s\n' \
  "$CONVERTER_URL" \
  "$CONVERTER_TOKEN" >> functions/.env

echo "Converter deployed successfully: $CONVERTER_URL"
echo "Firebase Functions environment updated. The token was not printed."
