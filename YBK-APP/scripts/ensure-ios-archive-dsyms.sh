#!/bin/sh
set -eu

ARCHIVE_PATH="${1:-ios/build/Arnold.xcarchive}"
APP_BUNDLE_GLOB="$ARCHIVE_PATH/Products/Applications"/*.app
set -- $APP_BUNDLE_GLOB

if [ ! -d "$1" ]; then
  echo "App bundle not found in archive: $ARCHIVE_PATH/Products/Applications" >&2
  exit 1
fi

FRAMEWORKS_DIR="$1/Frameworks"
DSYMS_DIR="$ARCHIVE_PATH/dSYMs"

if [ ! -d "$FRAMEWORKS_DIR" ]; then
  echo "Frameworks directory not found: $FRAMEWORKS_DIR" >&2
  exit 1
fi

mkdir -p "$DSYMS_DIR"

generate_dsym() {
  framework_name="$1"
  binary_name="$2"
  binary_path="$FRAMEWORKS_DIR/$framework_name.framework/$binary_name"
  dsym_path="$DSYMS_DIR/$framework_name.framework.dSYM"

  if [ ! -f "$binary_path" ]; then
    echo "Skipping missing binary: $binary_path"
    return 0
  fi

  if [ -d "$dsym_path" ]; then
    echo "dSYM already present: $dsym_path"
    return 0
  fi

  echo "Generating dSYM for $framework_name.framework"
  xcrun dsymutil "$binary_path" -o "$dsym_path"
}

generate_dsym "React" "React"
generate_dsym "ReactNativeDependencies" "ReactNativeDependencies"
generate_dsym "hermesvm" "hermesvm"
