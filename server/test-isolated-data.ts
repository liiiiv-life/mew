import './config.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after } from 'node:test'

// Import before server modules in tests that mutate the account/permission store.
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-policy-test-'))
process.env.MEW_DATA_DIR = testData
after(() => fs.rmSync(testData, { recursive: true, force: true }))
