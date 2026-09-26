import mongoose, { Schema } from "mongoose";

export interface IShippingOption {
  id: string;
  label: string;
  description: string;
  price: number;
  enabled: boolean;
}

export interface ISettings {
  // Documento único: siempre key "main". El índice único evita que dos arranques creen dos.
  key: string;
  shippingOptions: IShippingOption[];
  announcement: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const shippingOptionSchema = new Schema<IShippingOption>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, default: 0, min: 0 },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const settingsSchema = new Schema<ISettings>(
  {
    key: { type: String, required: true, unique: true, default: "main" },
    shippingOptions: { type: [shippingOptionSchema], default: [] },
    announcement: { type: String, default: "" },
  },
  { timestamps: true },
);

export const Settings =
  mongoose.models.Settings || mongoose.model<ISettings>("Settings", settingsSchema);
