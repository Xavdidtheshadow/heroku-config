import { Flags } from '../interfaces'

// interface for reading/writing to .env file

import { readFile, writeFile } from 'mz/fs'
import { join } from 'path'
import { homedir } from 'os'

const cli: any = require('heroku-cli-util')

const DEFAULT_FNAME = '.env'
const header = '# this file was created automatically by heroku-config\n\n'

function objToFileFormat(obj: { [x: string]: string }) {
  let res = `${header}`
  // always write keys alphabetically; makes file writing deterministic
  let keys = Object.keys(obj).sort()
  keys.forEach(key => {
    res += `${key}="${obj[key]}"\n`
  })
  return res
}

function defaultMulti(): { key: string; values: string[] } {
  return {
    key: '',
    values: []
  }
}

// checks whether this is the end of a multi
function isEnding(s: string) {
  return s[s.length - 1] === '"'
}

function isSkippable(s: string) {
  return s[0] === '#' || s === ''
}

function unquote(s: string) {
  return s.replace(/^"|"$/g, '')
}

function objFromFileFormat(s: string, flags: Flags = {}) {
  let res: { [x: string]: string } = {}
  let splitter
  let multi = defaultMulti()

  // could also use process.platform but this feels more reliable
  if (s.match(/\r\n/)) {
    splitter = '\r\n'
  } else {
    splitter = '\n'
  }
  const lines = s.split(splitter)

  let expandedVars = ''
  if (flags.expanded) {
    // this is a regex string that shows non-standard values that are accepted
    expandedVars = String.raw`\.-`
  }

  const lineRegex = new RegExp(
    String.raw`^(export)?\s?([a-zA-Z_][a-zA-Z0-9_${expandedVars}]*)\s?=\s?(.*)$`
  )

  lines.forEach(function(line) {
    if (isSkippable(line)) {
      return
    }

    let maybeKVPair = line.match(lineRegex)
    if (maybeKVPair) {
      // regular line
      let key = maybeKVPair[2]
      const quotedVal = maybeKVPair[3]

      if (quotedVal[0] === '"' && !isEnding(quotedVal)) {
        // start of multi
        multi.key = key
        multi.values.push(quotedVal)
      } else {
        if (res[key] && !flags.quiet) {
          cli.warn(`[WARN]: "${key}" is in env file twice`)
        }
        res[key] = unquote(quotedVal)
      }
    } else if (multi.key) {
      // not a regular looking line, but we're in the middle of a multi
      multi.values.push(line)
      if (isEnding(line)) {
        res[multi.key] = unquote(multi.values.join('\n'))
        multi = defaultMulti()
      }
    } else {
      // borked
      if (!flags.quiet) {
        cli.warn(`[WARN]: unable to parse line: ${line}`)
      }
    }
  })

  return res
}

function question(val: string) {
  return [
    `Your config has a value called "${
      val
    }", which is usually pulled in error. Should we:`,
    '[d]elete | [i]gnore | [a]lways (delete) | [n]ever (delete)',
    'that key/value pair for this app?'
  ].join('\n\n')
}

export const read = (fname = DEFAULT_FNAME, flags: Flags) => {
  return readFile(fname, 'utf-8')
    .then(data => {
      return Promise.resolve(objFromFileFormat(data, flags))
    })
    .catch(() => {
      // if it doesn't exist or we can't read, just start from scratch
      return Promise.resolve({})
    })
}
export const write = (
  obj: { [x: string]: string },
  fname = DEFAULT_FNAME,
  flags: Flags = {}
) => {
  return writeFile(fname, objToFileFormat(obj))
    .then(() => {
      if (!flags.quiet) {
        cli.log(`Successfully wrote config to "${fname}"!`)
      }
    })
    .catch(err => {
      return Promise.reject(
        new Error(`Error writing to file "${fname}" (${err.message})`)
      )
    })
}
export const shouldDeleteProd = async (context: any, val: string) => {
  console.log('calling shouddeleteprod')
  const settingsUrl = join(homedir(), '.heroku_config_settings.json')

  let settings
  try {
    settings = JSON.parse(await readFile(settingsUrl, 'utf-8'))
    console.log('read settings')
  } catch (e) {
    console.log('should delete prod catch', e)
    settings = {}
  }

  if (!settings[context.app]) {
    let answer = (await cli.prompt(question(val))).toLowerCase()
    console.log('answer is', answer)

    if (answer === 'd' || answer === 'delete') {
      return true
    } else if (answer === 'i' || answer === 'ignore') {
      return false
    } else if (answer === 'a' || answer === 'always') {
      settings[context.app] = true
      await writeFile(settingsUrl, JSON.stringify(settings))
      return true
    } else if (answer === 'n' || answer === 'never') {
      settings[context.app] = false
      await writeFile(settingsUrl, JSON.stringify(settings))
      return false
    } else {
      cli.exit(1, 'Invalid command. Use one of [d|i|a|n] instead')
    }
  } else {
    console.log('no prompt, returning', settings[context.app])
    return settings[context.app]
  }
}