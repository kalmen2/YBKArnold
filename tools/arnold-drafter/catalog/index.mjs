// Product catalog registry.
//
// To add a product type: drop a module in this folder that default-exports
// { type, label, params, build } and list it here. No other file changes.

import credenza from './casegood.credenza.mjs'
import receptionDesk from './casegood.reception-desk.mjs'
import table from './table.rectangular.mjs'

const PRODUCTS = [credenza, receptionDesk, table]

export const CATALOG = new Map(PRODUCTS.map((product) => [product.type, product]))

export function getProduct(type) {
  if (typeof type !== 'string' || type.trim() === '') {
    throw new Error(`product.type is required. Available: ${[...CATALOG.keys()].join(', ')}`)
  }
  const product = CATALOG.get(type.trim())
  if (!product) {
    throw new Error(
      `unknown product type "${type}". Available: ${[...CATALOG.keys()].join(', ')}.\n` +
        '  Add a new catalog module rather than forcing the shape out of a near-miss type.',
    )
  }
  return product
}
