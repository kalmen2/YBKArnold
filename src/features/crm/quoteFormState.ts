// The shape of a quote while it is being filled in.
//
// Two editors now write this: the original staged Add Opportunity dialog and
// the newer single-page form. Both hand the same object to the same create
// call, so the shape lives here rather than inside either of them.
import type { CrmQuoteLineImage, CrmQuoteServiceLocation, CrmQuoteTotalPriceType } from './api'
import type { QuoteLineFormState } from './quoteLines'

export type QuoteServiceItemFormState = {
  id: string
  title: string
  description: string
  qty: string
  unitPrice: string
  extPrice: string
  images: CrmQuoteLineImage[]
  location: CrmQuoteServiceLocation | null
}

export type QuoteFormState = {
  dealerSourceId: string
  quoteNumber: string
  title: string
  opportunityDateInput: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  salesRep: string
  projectType: string
  leadTime: string
  paymentTerms: string
  subtotal: string
  discountPercent: string
  discountScope: 'products' | 'products_and_freight'
  totalPriceType: CrmQuoteTotalPriceType
  freight: string
  freightDescription: string
  notes: string
  lineItems: QuoteLineFormState[]
  additionalServices: QuoteServiceItemFormState[]
  shippingServices: QuoteServiceItemFormState[]
  origin: 'website' | 'excel'
  sourceWorkbookUrl: string
  sourceWorkbookName: string
  convertedPdfUrl: string
  convertedPdfName: string
}

/** Arnold is always the sender, so the From block is fixed text, not a field. */
export const QUOTE_SENDER = {
  name: 'Arnold Contract',
  address: '120 Coit Street, Irvington, NJ 07111',
  phone: '866-425-6529',
} as const
