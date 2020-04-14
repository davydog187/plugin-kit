const fs = require('fs')
const path = require('path')
const util = require('util')

const stat = util.promisify(fs.stat)
const readFile = util.promisify(fs.readFile)

const allowedPartProps = ['name', 'implements', 'path', 'description']
const disallowedPluginProps = ['api', 'project', 'plugins', 'env']

module.exports = {getPaths, readManifest, validateManifest}

async function getPaths(options = {}) {
  validateOptions(options)

  const {basePath} = options
  const manifest = await readManifest(options)
  if (!manifest.paths) {
    return null
  }

  const getPath = (relative) => path.resolve(path.join(basePath, relative))
  return {
    compiled: getPath(manifest.paths.compiled),
    source: getPath(manifest.paths.source),
  }
}

async function readManifest(options) {
  validateOptions(options)

  const {basePath} = options
  const manifestPath = path.normalize(path.join(basePath, 'sanity.json'))

  let content
  try {
    content = await readFile(manifestPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'No sanity.json found. sanity.json is required for plugins to function. Use `sanipack init` for a new plugin, or create an empty `sanity.json` with an empty object (`{}`) for existing ones.'
      )
    }

    throw new Error(`Failed to read "${manifestPath}": ${err.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error(`Error parsing "${manifestPath}": ${err.message}`)
  }

  await validateManifest(parsed, options)
  return parsed
}

async function validateManifest(manifest, opts = {}) {
  const options = {isPlugin: true, ...opts}
  validateOptions(options)

  if (!isObject(manifest)) {
    throw new Error(`Invalid sanity.json: Root must be an object`)
  }

  if (options.isPlugin) {
    await validatePluginManifest(manifest, options)
  } else {
    await validateProjectManifest(manifest, options)
  }

  if ('root' in manifest && typeof manifest.root !== 'boolean') {
    throw new Error(`Invalid sanity.json: "root" property must be a boolean if declared`)
  }

  validateParts(manifest, options)
}

function validateOptions(opts) {
  const options = opts || {}
  if (!isObject(options)) {
    throw new Error(`Options must be an object`)
  }

  if (typeof options.basePath !== 'string') {
    throw new Error(`"options.basePath" must be a string (path to plugin base path)`)
  }

  if (typeof options.pluginName !== 'string') {
    throw new Error(`"options.pluginName" must be a string (npm module name)`)
  }
}

function validateProjectManifest(manifest, options) {
  if ('paths' in manifest) {
    throw new Error(`Invalid sanity.json: "paths" property has no meaning in a project manifest`)
  }
}

async function validatePluginManifest(manifest, options) {
  const disallowed = Object.keys(manifest)
    .filter((key) => disallowedPluginProps.includes(key))
    .map((key) => `"${key}"`)

  if (disallowed.length > 0) {
    const plural = disallowed.length > 1 ? 's' : ''
    const joined = disallowed.join(', ')
    throw new Error(
      `Invalid sanity.json: Key${plural} ${joined} ${
        plural ? 'are' : 'is'
      } not allowed in a plugin manifest`
    )
  }

  if (manifest.root) {
    throw new Error(`Invalid sanity.json: "root" cannot be truthy in a plugin manifest`)
  }

  await validatePaths(manifest, options)
}

async function validatePaths(manifest, options) {
  if (!('paths' in manifest)) {
    return
  }

  if (!isObject(manifest.paths)) {
    throw new Error(`Invalid sanity.json: "paths" must be an object if declared`)
  }

  if (typeof manifest.paths.compiled !== 'string') {
    throw new Error(
      `Invalid sanity.json: "paths" must have a (string) "compiled" property if declared`
    )
  }

  if (typeof manifest.paths.source !== 'string') {
    throw new Error(
      `Invalid sanity.json: "paths" must have a (string) "source" property if declared`
    )
  }

  const sourcePath = path.resolve(options.basePath, manifest.paths.source)
  let srcStats
  try {
    srcStats = await stat(sourcePath)
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`sanity.json references "source" path which does not exist: "${sourcePath}"`)
    }
  }

  if (!srcStats.isDirectory()) {
    throw new Error(
      `sanity.json references "source" path which is not a directory: "${sourcePath}"`
    )
  }
}

function validateParts(manifest, options) {
  if (!('parts' in manifest)) {
    return
  }

  if (!Array.isArray(manifest.parts)) {
    throw new Error(`Invalid sanity.json: "parts" must be an array if declared`)
  }

  manifest.parts.some((part, i) => validatePart(part, i, options))
}

function validatePart(part, index, options) {
  if (!isObject(part)) {
    throw new Error(`Invalid sanity.json: "parts[${index}]" must be an object`)
  }

  validateAllowedPartKeys(part, index)
  validatePartStringValues(part, index)
  validatePartNames(part, index, options)
  // @todo validate that files exist and is not doubly-specified inside of configured paths
}

function validatePartNames(part, index, options) {
  const pluginName = options.pluginName.replace(/^sanity-plugin-/, '')
  if (part.name && !part.name.startsWith(`part:${pluginName}/`)) {
    throw new Error(
      `Invalid sanity.json: "name" must be prefixed with "part:${pluginName}/" - got "${part.name}" (parts[${index}])`
    )
  }

  if (part.implements && !part.implements.startsWith('part:')) {
    throw new Error(
      `Invalid sanity.json: "implements" must be prefixed with "part:" - got "${part.implements}" (parts[${index}])`
    )
  }
}

function validateAllowedPartKeys(part, index) {
  const disallowed = Object.keys(part)
    .filter((key) => !allowedPartProps.includes(key))
    .map((key) => `"${key}"`)

  if (disallowed.length > 0) {
    const plural = disallowed.length > 1 ? 's' : ''
    const joined = disallowed.join(', ')
    throw new Error(
      `Invalid sanity.json: Key${plural} ${joined} ${
        plural ? 'are' : 'is'
      } not allowed in a part declaration (parts[${index}])`
    )
  }
}

function validatePartStringValues(part, index) {
  const nonStrings = Object.keys(part)
    .filter((key) => typeof part[key] !== 'string')
    .map((key) => `"${key}"`)

  if (nonStrings.length > 0) {
    const plural = nonStrings.length > 1 ? 's' : ''
    const joined = nonStrings.join(', ')
    throw new Error(
      `Invalid sanity.json: Key${plural} ${joined} should be of type string (parts[${index}])`
    )
  }
}

function isObject(obj) {
  return !Array.isArray(obj) && obj !== null && typeof obj === 'object'
}
