import mongoose, { Schema, Types } from "mongoose";

export interface IProductImage {
  url: string;
  // "" cuando la imagen es una URL externa y no vive en Cloudinary.
  publicId: string;
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
    stock: { type: Number, default: 0, min: 0 },
    isPublished: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

productSchema.index({ isPublished: 1, category: 1, createdAt: -1 });
productSchema.index({ name: "text", brand: "text" });

export const Product =
  mongoose.models.Product || mongoose.model<IProduct>("Product", productSchema);
