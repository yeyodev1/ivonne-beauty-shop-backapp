import mongoose, { Schema, Types } from "mongoose";

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "canceled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Estados que cuentan como venta cobrada. */
export const PAID_STATUSES: OrderStatus[] = ["paid", "preparing", "shipped", "delivered"];

export interface IOrderItem {
  product: Types.ObjectId;
  name: string;
  slug: string;
  brand: string;
  image: string;
  price: number;
  quantity: number;
}

export interface IOrder {
  number: string;
  user: Types.ObjectId | null;
  customer: { name: string; email: string; phone: string; documentId: string };
  // Copia del producto al momento de comprar: si luego cambia el precio o se borra, el pedido no cambia.
  items: IOrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  shipping: { optionId: string; label: string };
  address: { city: string; street: string; reference: string };
  notes: string;
  clientTransactionId: string;
  status: OrderStatus;
  paidAt: Date | null;
  // Respuesta cruda de Payphone (o el error). Solo la ve el admin.
  payphone: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    slug: { type: String, default: "" },
    brand: { type: String, default: "" },
    image: { type: String, default: "" },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    number: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    customer: {
      name: { type: String, required: true },
      email: { type: String, required: true, lowercase: true, trim: true, index: true },
      phone: { type: String, default: "" },
      documentId: { type: String, default: "" },
    },
    items: { type: [orderItemSchema], default: [] },
    subtotal: { type: Number, required: true },
    shippingCost: { type: Number, required: true },
    total: { type: Number, required: true },
    shipping: {
      optionId: { type: String, required: true },
      label: { type: String, default: "" },
    },
    address: {
      city: { type: String, default: "" },
      street: { type: String, default: "" },
      reference: { type: String, default: "" },
    },
    notes: { type: String, default: "" },
    clientTransactionId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    paidAt: { type: Date, default: null },
    payphone: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);

orderSchema.index({ createdAt: -1 });

export const Order = mongoose.models.Order || mongoose.model<IOrder>("Order", orderSchema);
