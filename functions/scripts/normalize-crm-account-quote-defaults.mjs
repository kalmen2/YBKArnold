import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'

const DEFAULT_PAYMENT_TERMS = '50% Deposit / 50% CBD'
const STATE_SUFFIX = /(?<!\bof)\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s*$/i
const STATE_NAME_SUFFIX = /(?<!\bof)\s+(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\s*$/i

function parseArgs(argv) {
  return { apply: argv.includes('--apply') }
}

function normalizeQuoteCompanyName(value) {
  const original = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!original) return ''

  const normalized = original
    .replace(/\s+(?:-|–|—)\s+.+$/, '')
    .replace(/\s*\((?:closed|inactive|former)\)\s*$/i, '')
    .replace(/\s*(?:\(|\[)(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?:\)|\])\s*$/i, '')
    .replace(STATE_NAME_SUFFIX, '')
    .replace(STATE_SUFFIX, '')
    .replace(/[;,\s]+$/, '')
    .trim()

  return normalized || original
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2))
  dotenv.config({ path: '.env' })
  const uri = process.env.MONGODB_URI_CRM || process.env.MONGODB_URI
  const databaseName = process.env.MONGODB_DB_CRM || process.env.MONGODB_DB
  if (!uri || !databaseName) throw new Error('Missing CRM MongoDB configuration.')

  const client = new MongoClient(uri)
  await client.connect()
  try {
    const collection = client.db(databaseName).collection('crm_accounts')
    const accounts = await collection.find({ recordStatus: { $ne: 'deleted' } }, { projection: { _id: 1, name: 1, quoteCompanyName: 1, paymentTerms: 1 } }).toArray()
    const operations = []
    const changedNames = []

    for (const account of accounts) {
      const quoteCompanyName = normalizeQuoteCompanyName(account.name)
      const updates = {}
      if (!String(account.quoteCompanyName || '').trim() && quoteCompanyName) {
        updates.quoteCompanyName = quoteCompanyName
        if (quoteCompanyName !== String(account.name || '').trim()) changedNames.push({ name: account.name, quoteCompanyName })
      }
      if (!String(account.paymentTerms || '').trim()) updates.paymentTerms = DEFAULT_PAYMENT_TERMS
      if (Object.keys(updates).length > 0) {
        operations.push({ updateOne: { filter: { _id: account._id }, update: { $set: { ...updates, updatedAt: new Date().toISOString() } } } })
      }
    }

    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scanned: accounts.length, updates: operations.length, normalizedNameChanges: changedNames.length, sample: changedNames.slice(0, 80) }, null, 2))
    if (apply && operations.length > 0) {
      const result = await collection.bulkWrite(operations, { ordered: false })
      console.log(JSON.stringify({ matched: result.matchedCount, modified: result.modifiedCount }, null, 2))
    }
  } finally {
    await client.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
