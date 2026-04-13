#!/usr/bin/env node

const { execSync } = require('node:child_process')

function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!commandExists('xcodebuild')) {
  console.error('Xcode command line tools are missing. Install Xcode first.')
  process.exit(1)
}

if (!commandExists('pod')) {
  console.error('CocoaPods is required for local iOS builds. Install with: brew install cocoapods')
  process.exit(1)
}

console.log('Local iOS toolchain looks ready (xcodebuild + pod).')
