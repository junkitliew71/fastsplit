export interface Participant { id: string; name: string }
export interface ReceiptItem { id: string; name: string; quantity: number; unitPriceCents: number; totalPriceCents: number; confidence?: number; needsReview?: boolean }
export interface ItemUnit { id: string; itemId: string; name: string; priceCents: number; participantIds: string[] }
export interface ParticipantSettlement { participantId: string; foodSubtotalCents: number; serviceChargeCents: number; taxCents: number; discountCents: number; finalTotalCents: number }
export interface Bill { id: string; requestId: string; sessionId: string; restaurant: string; createdAt: string; expiresAt: string; participants: Participant[]; items: ReceiptItem[]; itemUnits: ItemUnit[]; subtotalCents: number; serviceChargeCents: number; taxCents: number; discountCents: number; totalCents: number; settlements: ParticipantSettlement[]; paymentStatus?: Record<string, boolean> }
export type Receipt = Pick<Bill,'restaurant'|'items'|'serviceChargeCents'|'taxCents'|'discountCents'> & { scanWarning?: string; printedSubtotalCents?: number | null; printedTotalCents?: number | null; roundingCents?: number; receiptNeedsReview?: boolean };
export interface OcrToken { id:string; text:string; confidence:number; bbox:{x:number;y:number;width:number;height:number} }
export type ReceiptField = 'restaurant'|'itemName'|'quantity'|'unitPrice'|'itemTotal'|'subtotal'|'serviceCharge'|'tax'|'discount'|'rounding'|'grandTotal'|'ignore';
export interface ReceiptAssignment { tokenIds:string[]; field:ReceiptField; itemIndex?:number; correctedText?:string }
export interface ReceiptMapping { receiptId:string; ocrTokens:OcrToken[]; assignments:ReceiptAssignment[]; savedAt:string }
