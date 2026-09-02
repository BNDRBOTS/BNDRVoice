import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let commit = 'unknown'
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim() || 'unknown'
} catch {
  commit = 'unknown'
}

const versionPath = join(root, 'version.json')
const version = JSON.parse(readFileSync(versionPath, 'utf8'))
version.commit = commit
writeFileSync(versionPath, `${JSON.stringify(version, null, 2)}\n`)

const configPath = join(root, 'config.js')
const config = readFileSync(configPath, 'utf8').replace(
  /BUILD_COMMIT:\s*'[^']*'/,
  `BUILD_COMMIT: '${commit}'`,
)
writeFileSync(configPath, config)
process.stdout.write(`stamped ${commit}\n`)
