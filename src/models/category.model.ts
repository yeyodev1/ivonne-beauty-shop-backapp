import mongoose, { Schema } from "mongoose";

export interface ICategory {
  name: string;
  slug: string;
  description: string;
  image: string;
  // Se guarda para poder borrar la imagen anterior de Cloudinary al reemplazarla.
  imagePublicId: string;
  order: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Category =
  mongoose.models.Category || mongoose.model<ICategory>("Category", categorySchema);
