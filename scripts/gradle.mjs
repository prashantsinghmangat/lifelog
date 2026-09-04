// Runs a Gradle task in android/ with a JDK the Android Gradle plugin accepts.
//
// The machine's JAVA_HOME is a JDK 11, which AGP rejects, and other projects on
// it may depend on that. So rather than changing JAVA_HOME globally or
// committing a machine-specific org.gradle.java.home into gradle.properties —
// which would then be wrong on any other machine, including the Mac an iOS
// build would need — the JDK is resolved here, per invocation.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The Android Gradle plugin refuses anything below 17, and Gradle 8.14 cannot
// run on 25 at all — it fails compiling build scripts with "Unsupported class
// file major version 69". Android Studio bundles a 25, so the version has to be
// read rather than assumed.
const MIN_JDK = 17
const MAX_JDK = 24

/** JDK homes to consider, before filtering by version. */
function homes() {
  const roots = [
    'C:/Program Files/Microsoft',
    'C:/Program Files/Eclipse Adoptium',
    'C:/Program Files/Java',
    '/Library/Java/JavaVirtualMachines',
    '/usr/lib/jvm',
  ]

  const found = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const home = join(root, name)
      // macOS nests the real home inside the bundle.
      found.push(existsSync(join(home, 'Contents/Home')) ? join(home, 'Contents/Home') : home)
    }
  }

  return [
    process.env.JAVA_HOME,
    ...found,
    'C:/Program Files/Android/Android Studio/jbr',
    `${process.env.LOCALAPPDATA ?? ''}/Programs/Android Studio/jbr`,
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  ].filter((path) => typeof path === 'string' && path !== '' && existsSync(path))
}

/** Reads the major version out of a JDK's own `release` file. */
function major(home) {
  try {
    const release = readFileSync(join(home, 'release'), 'utf8')
    const found = /JAVA_VERSION="?(\d+)/.exec(release)
    return found?.[1] === undefined ? null : Number(found[1])
  } catch {
    return null
  }
}

function jdk() {
  const usable = homes()
    .map((home) => ({ home, version: major(home) }))
    .filter((found) => found.version !== null && found.version >= MIN_JDK && found.version <= MAX_JDK)
    // Newest usable wins, so an added JDK is picked up without configuration.
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))

  return usable[0]?.home
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
    `No JDK between ${MIN_JDK} and ${MAX_JDK} found.\n` +
      'Android Gradle plugin needs 17 or newer; Gradle 8.14 cannot run on 25.\n' +
      'Install one, for example: winget install Microsoft.OpenJDK.21',
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
