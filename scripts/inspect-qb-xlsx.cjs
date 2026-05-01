const XLSX = require('xlsx')
const path = require('path')

const dir = path.resolve(__dirname, '..', 'functions', 'data-qb')
const files = ['Book2.xlsm', 'Book3.xlsm', 'Purchase Detail 5-1-26.xlsx']

for (const f of files) {
  const wb = XLSX.readFile(path.join(dir, f))
  console.log('===== FILE:', f, '=====')
  console.log('Sheets:', wb.SheetNames)
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    const ref = ws['!ref']
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null })
    console.log('--- Sheet:', s, 'ref:', ref, 'rows:', json.length)
    const limit = Math.min(20, json.length)
    for (let i = 0; i < limit; i++) {
      console.log('R' + i + ':', JSON.stringify(json[i]).slice(0, 500))
    }
  }
}
