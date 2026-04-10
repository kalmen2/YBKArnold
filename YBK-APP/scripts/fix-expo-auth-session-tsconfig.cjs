const fs = require('fs')
const path = require('path')

const targetFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-auth-session',
  'tsconfig.json',
)

const moduleScriptsBaseShim = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-module-scripts',
  'tsconfig.base',
)

const localModuleScriptsShimDir = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-auth-session',
  'expo-module-scripts',
)

const localModuleScriptsBaseShim = path.join(localModuleScriptsShimDir, 'tsconfig.base')

if (!fs.existsSync(targetFile)) {
  process.exit(0)
}

const raw = fs.readFileSync(targetFile, 'utf8')
let updated = raw

updated = updated.replace(
  '"extends": "expo-module-scripts/tsconfig.base.json"',
  '"extends": "expo-module-scripts/tsconfig.base"',
)

if (!/"rootDir"\s*:/.test(updated)) {
  updated = updated.replace(
    '"outDir": "./build"',
    '"outDir": "./build",\n    "rootDir": "./src"',
  )
}

if (updated !== raw) {
  fs.writeFileSync(targetFile, updated, 'utf8')
}

if (!fs.existsSync(moduleScriptsBaseShim)) {
  fs.writeFileSync(moduleScriptsBaseShim, '{\n  "extends": "./tsconfig.base.json"\n}\n', 'utf8')
}

if (!fs.existsSync(localModuleScriptsShimDir)) {
  fs.mkdirSync(localModuleScriptsShimDir, { recursive: true })
}

if (!fs.existsSync(localModuleScriptsBaseShim)) {
  fs.writeFileSync(
    localModuleScriptsBaseShim,
    '{\n  "extends": "../../expo-module-scripts/tsconfig.base.json"\n}\n',
    'utf8',
  )
}
