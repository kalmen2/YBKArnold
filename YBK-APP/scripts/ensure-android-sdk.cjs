#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const androidDir = path.join(projectRoot, 'android')
const localPropertiesPath = path.join(androidDir, 'local.properties')

const candidateSdkPaths = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(os.homedir(), 'Library', 'Android', 'sdk'),
  path.join(os.homedir(), 'Android', 'Sdk'),
].filter(Boolean)

const sdkDir = candidateSdkPaths.find((candidate) => {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
})

if (!sdkDir) {
  console.error('Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT first.')
  process.exit(1)
}

const normalizedSdkDir = sdkDir.replace(/\\/g, '\\\\')
const localPropertiesContent = `sdk.dir=${normalizedSdkDir}\n`

let currentContent = ''
if (fs.existsSync(localPropertiesPath)) {
  currentContent = fs.readFileSync(localPropertiesPath, 'utf8')
}

if (currentContent.trim() !== localPropertiesContent.trim()) {
  fs.writeFileSync(localPropertiesPath, localPropertiesContent, 'utf8')
  console.log(`Updated ${path.relative(projectRoot, localPropertiesPath)} with ${sdkDir}`)
} else {
  console.log(`Using existing ${path.relative(projectRoot, localPropertiesPath)} with ${sdkDir}`)
}

const rnHermesDir = path.join(projectRoot, 'node_modules', 'react-native', 'sdks', 'hermesc')
const fallbackHermesDir = path.join(projectRoot, 'node_modules', 'hermes-compiler', 'hermesc')
const rnHermesCompilerPath = path.join(rnHermesDir, 'osx-bin', 'hermesc')
const fallbackHermesCompilerPath = path.join(fallbackHermesDir, 'osx-bin', 'hermesc')

try {
  const hasRnHermesCompiler = fs.existsSync(rnHermesCompilerPath)
  const hasFallbackHermesCompiler = fs.existsSync(fallbackHermesCompilerPath)

  if (!hasRnHermesCompiler && hasFallbackHermesCompiler) {
    fs.rmSync(rnHermesDir, { recursive: true, force: true })
    fs.cpSync(fallbackHermesDir, rnHermesDir, { recursive: true })
    fs.chmodSync(rnHermesCompilerPath, 0o755)
    console.log('Restored missing react-native Hermes compiler from hermes-compiler package.')
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`Could not ensure Hermes compiler path: ${message}`)
}
