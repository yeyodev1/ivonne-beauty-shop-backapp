import mongoose, { Schema, Types } from "mongoose";

export interface IProductImage {
  url: string;
  // "" cuando la imagen es una URL externa y no vive en Cloudinary.
  publicId: string;
}

export interface IProductShade {
  _id?: Types.ObjectId;
  name: string;
  // Hex (#c68b6e) para pintar la muestra; "" si no se definió.
  color: string;
  stock: number;
  // Apagado = bloqueado a mano aunque quede stock (p. ej. dejó de traer ese tono).
  isActive: boolean;
}

export interface IProduct {
  name: string;
  slug: string;
  brand: string;
  category: Types.ObjectId | null;
  description: string;
  // Montos en centavos para no arrastrar errores de coma flotante.
  price: number;
  compareAtPrice: number | null;
  images: IProductImage[];
  shades: IProductShade[];
  // Con tonos, es la suma del stock de los tonos activos: así "agotado" y "poco stock" siguen igual.
  stock: number;
  isPublished: boolean;
  isFeatured: boolean;
  tags: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

const productImageSchema = new Schema<IProductImage>(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
  },
  { _id: false },
);

// Con _id propio: el carrito y los pedidos apuntan al tono por id, no por nombre.
const productShadeSchema = new Schema<IProductShade>({
  name: { type: String, required: true, trim: true },
  color: { type: String, default: "" },
  stock: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
});

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    brand: { type: String, default: "", trim: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: null },
    images: { type: [productImageSchema], default: [] },
    shades: { type: [productShadeSchema], default: [] },
    stock: { type: Number, default: 0, min: 0 },
    isPublished: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

export function sellableShadeStock(shades: IProductShade[]): number {
  return shades.reduce((sum, s) => sum + (s.isActive ? s.stock : 0), 0);
}

productSchema.pre("save", function () {
  if (this.shades.length > 0) this.stock = sellableShadeStock(this.shades);
});

productSchema.index({ isPublished: 1, category: 1, createdAt: -1 });
productSchema.index({ name: "text", brand: "text" });

export const Product =
  mongoose.models.Product || mongoose.model<IProduct>("Product", productSchema);
