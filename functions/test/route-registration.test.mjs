// Registers every route module that was converted to the Monday card store.
//
// Module-scope and registration-time faults - a store built before its
// dependency is destructured, a missing import, a name out of scope - throw
// here rather than at cold start in production. That class of bug is invisible
// to node --check, which only parses.

import test from 'node:test'
import assert from 'node:assert/strict'

function fakeApp() {
  const routes = []
  const record = (method) => (path) => { routes.push(`${method} ${path}`) }
  return { routes, get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE'), patch: record('PATCH'), use: () => {} }
}

// Every dependency any of these modules destructures. Values are inert stubs;
// registration must not call them.
const deps = new Proxy({
  getCollections: async () => ({}),
  requireFirebaseAuth: (req, res, next) => next(),
  requireManagerOrAdminRole: (req, res, next) => next(),
  requireOfficeManagerOrAdminRole: (req, res, next) => next(),
  requireSalesManagerOrAdminRole: (req, res, next) => next(),
  requireAdminRole: (req, res, next) => next(),
  requireApprovedLinkedWorker: (req, res, next) => next(),
}, {
  get: (target, prop) => (prop in target ? target[prop] : () => {}),
  has: () => true,
})

const MODULES = [
  ['progress-routes',          '../src/orders/progress-routes.mjs',            'registerOrderProgressRoutes'],
  ['document-routes',          '../src/orders/document-routes.mjs',            'registerOrderDocumentRoutes'],
  ['shipping-routes',          '../src/orders/shipping-routes.mjs',            'registerOrderShippingRoutes'],
  ['warranty-routes',          '../src/orders/warranty-routes.mjs',            'registerOrderWarrantyRoutes'],
  ['dashboard-support-routes', '../src/routes/dashboard-support-routes.mjs',   'registerDashboardSupportRoutes'],
  ['orders-routes',            '../src/routes/orders-routes.mjs',              'registerOrdersRoutes'],
  ['timesheet-routes',         '../src/routes/timesheet-routes.mjs',           'registerTimesheetRoutes'],
]

for (const [name, path, exportName] of MODULES) {
  test(`${name} registers without throwing`, async () => {
    const mod = await import(path)
    assert.equal(typeof mod[exportName], 'function', `${exportName} is exported`)
    const app = fakeApp()
    mod[exportName](app, deps)
    assert.ok(app.routes.length > 0, `${name} registered at least one route`)
  })
}

test('the Monday sync helpers construct without throwing', async () => {
  const { createMondaySyncHelpers } = await import('../src/orders/monday-sync.mjs')
  const helpers = createMondaySyncHelpers({ getCollections: async () => ({}) })
  assert.equal(typeof helpers.resolveMondayOrderContext, 'function')
})

test('the card store constructs and exposes the compat surface', async () => {
  const { createMondayCardStore } = await import('../src/orders/monday-card-store.mjs')
  const s = createMondayCardStore({ getCollections: async () => ({}) })
  for (const fn of ['writeMondayCard', 'readMondayCard', 'deleteMondayCard', 'updateOneCompat', 'findOneAndUpdateCompat']) {
    assert.equal(typeof s[fn], 'function', `${fn} exists`)
  }
})
