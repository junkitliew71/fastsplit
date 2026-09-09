export interface Participant { id: string; name: string }
export interface ReceiptItem { id: string; name: string; quantity: number; unitPriceCents: number; totalPriceCents: number }
export interface ItemUnit { id: string; itemId: string; name: string; priceCents: number; participantIds: string[] }
export interface ParticipantSettlement { participantId: string; foodSubtotalCents: number; serviceChargeCents: number; taxCents: number; discountCents: number; finalTotalCents: number }
export interface Bill { id: string; requestId: string; sessionId: string; restaurant: string; createdAt: string; expiresAt: string; participants: Participant[]; items: ReceiptItem[]; itemUnits: ItemUnit[]; subtotalCents: number; serviceChargeCents: number; taxCents: number; discountCents: number; totalCents: number; settlements: ParticipantSettlement[] }
export type Receipt = Pick<Bill,'restaurant'|'items'|'serviceChargeCents'|'taxCents'|'discountCents'> & { scanWarning?: string };
