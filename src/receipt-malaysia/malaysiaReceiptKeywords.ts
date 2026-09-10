/** Malaysia-oriented labels. Keep these as data so new POS dialects are easy to add. */
export const serviceLabels = /\b(?:service\s*(?:charge|chg)?|svc\s*(?:charge|chg)?|serv\s*chg|sc|caj\s*perkhidmatan)\b|服务费|服務費/i;
export const taxLabels = /\b(?:g\.?s\.?t\.?|s\.?s\.?t\.?|service\s*tax|sales\s*tax|tax(?:\s*amount)?|cukai(?:\s*(?:perkhidmatan|jualan))?)\b|税|稅|服务税|服務稅/i;
export const discountLabels = /\b(?:discount|disc\.?|promo(?:tion)?|voucher|rebate|member\s*(?:discount|disc)|loyalty\s*discount|coupon|sconto|diskaun|promosi|baucar|rebat)\b|折扣|优惠|優惠/i;
export const roundingLabels = /\b(?:round(?:ing|\s*off)?|roundoff|rounding\s*adjustment|adjustment|pembundaran)\b/i;
export const deliveryLabels = /\b(?:delivery\s*(?:fee|charge)?|platform\s*fee|service\s*fee|small\s*order\s*fee)\b/i;
export const packagingLabels = /\b(?:pack(?:ing|aging)(?:\s*fee)?|container|bag\s*fee|box\s*fee|take\s*away)\b/i;
export const paymentLabels = /\b(?:cash|tunai|card|credit\s*card|debit\s*card|visa|mastercard|amex|mydebit|duitnow|qr(?:\s*pay(?:ment)?)?|touch\s*'?n?\s*go|tng(?:\s*ewallet)?|grabpay|boost|shopeepay|mae|e-?wallet|cash\s*(?:received|tendered)|tender(?:ed)?|change|balance|baki)\b|现金|現金|找零/i;
export const totalLabels = /\b(?:grand\s*total|net\s*total|final\s*total|total\s*(?:due|amount|payable|sales|gst)?|amount\s*(?:due|payable)|net\s*amount|jumlah(?:\s*(?:besar|perlu\s*dibayar))?|totale)\b|总计|總計|合计|合計|应付|應付|应收|實收|实收/i;
export const subtotalLabels = /\b(?:sub\s*[- ]?total|sub\s*ttl\.?|sub\s*[- ]?ttl|subtotale|total\s*before\s*tax|jumlah\s*kecil|subjumlah)\b|小计|小計/i;
export const metadataLabels = /\b(?:receipt|bill|invoice|inv|order|transaction|trans|ref)\s*(?:no|number|#)?\b|\b(?:cashier|server|staff|waiter|table|pax|covers?|guest|date|time|tel|phone|hp|whatsapp|reg(?:istration)?|company|ssm|sst|gst)\b/i;
export const footerLabels = /\b(?:thank\s*you|terima\s*kasih|please\s*come\s*again|sila\s*datang\s*lagi|no\s*refund|goods\s*sold|follow\s*us|facebook|instagram|wifi|member\s*(?:id|points?)|loyalty|points?\s*(?:earned|balance))\b/i;
export const businessLabels = /\b(?:sdn\.?\s*bhd\.?|berhad|enterprise|trading|restoran|restaurant|cafe|kedai|outlet|branch|jalan|jln|taman|persiaran|lorong|tingkat|selangor|kuala\s*lumpur|johor|penang|perak|pahang|melaka|sabah|sarawak)\b/i;
