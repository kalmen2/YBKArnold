const fs = require('fs')
const path = require('path')

const expoModulesCoreDir = path.join(__dirname, '..', 'node_modules', 'expo-modules-core')

if (!fs.existsSync(expoModulesCoreDir)) {
  process.exit(0)
}

const shimDefinitions = [
  {
    paths: ['ios/EXEventEmitter.h', 'ios/Legacy/EXEventEmitter.h'],
    content: [
      '#import <Foundation/Foundation.h>',
      '',
      '// Compatibility shim for modules that still conform to legacy EXEventEmitter.',
      '@protocol EXEventEmitter <NSObject>',
      '@end',
      '',
    ].join('\n'),
  },
  {
    paths: ['ios/EXLegacyExpoViewProtocol.h', 'ios/Legacy/EXLegacyExpoViewProtocol.h'],
    content: [
      '#import <UIKit/UIKit.h>',
      '',
      '// Compatibility shim for modules that still conform to legacy EXLegacyExpoViewProtocol.',
      '@protocol EXLegacyExpoViewProtocol <NSObject>',
      '@optional',
      '- (void)removeReactSubview:(UIView *)subview;',
      '@end',
      '',
    ].join('\n'),
  },
  {
    paths: ['ios/EXEventEmitterService.h', 'ios/Legacy/EXEventEmitterService.h'],
    content: [
      '#import <Foundation/Foundation.h>',
      '',
      '// Compatibility shim for modules that still consume the legacy event emitter service.',
      '@protocol EXEventEmitterService <NSObject>',
      '- (void)sendEventWithName:(NSString *)eventName body:(id)body;',
      '@end',
      '',
    ].join('\n'),
  },
]

for (const definition of shimDefinitions) {
  for (const relativePath of definition.paths) {
    const targetPath = path.join(expoModulesCoreDir, relativePath)
    const targetDir = path.dirname(targetPath)

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, definition.content, 'utf8')
    }
  }
}

const definesPath = path.join(expoModulesCoreDir, 'ios', 'EXDefines.h')

if (fs.existsSync(definesPath)) {
  let definesRaw = fs.readFileSync(definesPath, 'utf8')

  if (!definesRaw.includes('EX_COMPAT_ERROR_WITH_MESSAGE_SHIM')) {
    const compatBlock = [
      '',
      '// EX_COMPAT_ERROR_WITH_MESSAGE_SHIM',
      '#ifndef EXErrorWithMessage',
      '#define EXErrorWithMessage(message) [NSError errorWithDomain:@"ExpoModulesCore" code:0 userInfo:@{ NSLocalizedDescriptionKey: (message) }]',
      '#endif',
      '',
      '#ifndef EXFatal',
      '#define EXFatal(error) NSLog(@"[ExpoModulesCore compatibility] %@", (error))',
      '#endif',
      '',
    ].join('\n')

    definesRaw = `${definesRaw}${compatBlock}`
  }

  if (!definesRaw.includes('EX_COMPAT_LOGGING_SHIM')) {
    const loggingCompatBlock = [
      '',
      '// EX_COMPAT_LOGGING_SHIM',
      '#ifndef EXLogInfo',
      '#define EXLogInfo(...) NSLog(__VA_ARGS__)',
      '#endif',
      '',
      '#ifndef EXLogWarn',
      '#define EXLogWarn(...) NSLog(__VA_ARGS__)',
      '#endif',
      '',
      '#ifndef EXLogError',
      '#define EXLogError(...) NSLog(__VA_ARGS__)',
      '#endif',
      '',
    ].join('\n')

    definesRaw = `${definesRaw}${loggingCompatBlock}`
  }

  if (!definesRaw.includes('EX_COMPAT_UM_PROMISE_SHIM')) {
    const umPromiseCompatBlock = [
      '',
      '// EX_COMPAT_UM_PROMISE_SHIM',
      '#ifndef UMPromiseResolveBlock',
      'typedef EXPromiseResolveBlock UMPromiseResolveBlock;',
      '#endif',
      '',
      '#ifndef UMPromiseRejectBlock',
      'typedef EXPromiseRejectBlock UMPromiseRejectBlock;',
      '#endif',
      '',
    ].join('\n')

    definesRaw = `${definesRaw}${umPromiseCompatBlock}`
  }

  fs.writeFileSync(definesPath, definesRaw, 'utf8')
}
