// Runs a Gradle task in android/ with a JDK the Android Gradle plugin accepts.
//
// The machine's JAVA_HOME is a JDK 11, which AGP rejects, and other projects on
// it may depend on that. So rather than changing JAVA_HOME globally or
// committing a machine-specific org.gradle.java.home into gradle.properties —
// which would then be wrong on any other machine, including the Mac an iOS
// build would need — the JDK is resolved here, per invocation.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const CANDIDATES = [
  process.env.CAPACITOR_ANDROID_STUDIO_PATH,
  'C:/Program Files/Android/Android Studio/jbr',
  `${process.env.LOCALAPPDATA ?? ''}/Programs/Android Studio/jbr`,
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
].filter((path) => typeof path === 'string' && path !== '')

function jdk() {
  // An explicit JAVA_HOME wins if it is not the one AGP refuses.
  const current = process.env.JAVA_HOME
  if (current !== undefined && current !== '' && !/jdk-?1[0-6]\b|jdk1\.8/.test(current)) {
    return current
  }
  return CANDIDATES.find((path) => existsSync(path))
}

const SDKS = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  `${process.env.LOCALAPPDATA ?? ''}/Android/Sdk`,
  `${process.env.HOME ?? ''}/Library/Android/sdk`,
  `${process.env.HOME ?? ''}/Android/Sdk`,
].filter((path) => typeof path === 'string' && path !== '')

function sdk() {
  return SDKS.find((path) => existsSync(path))
}

const home = jdk()
if (home === undefined) {
  console.error(
    'No usable JDK found. Android Gradle plugin needs JDK 17+.\n' +
      'Install Android Studio, or set JAVA_HOME to a JDK 17 or newer.',
  )
  process.exit(1)
}

const androidHome = sdk()
if (androidHome === undefined) {
  console.error(
    'No Android SDK found. Install it through Android Studio, or set ANDROID_HOME.',
  )
  process.exit(1)
}

const task = process.argv.slice(2)
if (task.length === 0) {
  console.error('Usage: node scripts/gradle.mjs <task> [...]')
  process.exit(1)
}

// A .bat can only be launched through a shell, and a shell resolves a bare name
// against PATH rather than cwd — hence the absolute, quoted path. Passing one
// command string instead of an args array also avoids Node's DEP0190 warning.
const wrapper =
  process.platform === 'win32' ? `"${resolve('android/gradlew.bat')}"` : './gradlew'
console.log(`JDK: ${home}`)
console.log(`SDK: ${androidHome}`)

const child = spawn(`${wrapper} ${task.join(' ')}`, {
  cwd: 'android',
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, JAVA_HOME: home, ANDROID_HOME: androidHome },
})

child.on('exit', (code) => process.exit(code ?? 1))
