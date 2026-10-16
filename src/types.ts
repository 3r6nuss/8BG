export interface User { id: string; username: string; role: 'admin' | 'member' }
export interface Person {
  id: string; name: string; birthDate: string; phone: string; notes: string;
  scanId: string | null; archived: number; createdAt: string;
}
export interface Product {
  id: string; name: string; buyPriceCents: number; sellPriceCents: number; priceCents: number; active: number;
}
export type Direction = 'buy' | 'sell';
export interface Purchase {
  id: string; direction: Direction; personId: string; personName: string; totalCents: number;
  notes: string; createdAt: string; createdBy: string;
}
export interface PurchaseItem {
  productId: string; productName: string; unitPriceCents: number; quantity: number; totalCents: number;
}
export interface PurchaseDetail extends Purchase { items: PurchaseItem[] }
export interface PurchasePage { items: Purchase[]; total: number; page: number; pageSize: number }
export interface Stats {
  persons: number; products: number; purchases: number; totalCents: number;
  purchaseCount: number; saleCount: number; purchaseTotalCents: number; saleTotalCents: number;
}
export interface Scan {
  scanId: string; imageUrl: string; fields: { name: string; birthDate: string };
  text: string; warning: string | null;
}
export interface Session { user: User; csrfToken: string }
