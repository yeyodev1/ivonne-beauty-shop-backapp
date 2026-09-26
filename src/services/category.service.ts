import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Category } from "../models/category.model";
import { Product } from "../models/product.model";
import { uniqueSlug } from "../utils/uniqueSlug";
import { deleteImage, isCloudinaryConfigured, uploadBuffer } from "./cloudinary.service";

const CATEGORY_FOLDER = "ivonne-beauty-shop/categories";

function toDto(doc: any, productCount?: number) {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.__v;
  delete obj.imagePublicId;
  if (productCount !== undefined) obj.productCount = productCount;
  return obj;
}

async function countByCategory(onlyPublished: boolean): Promise<Map<string, number>> {
  const match = onlyPublished ? { isPublished: true } : {};
  const rows = await Product.aggregate([
    { $match: { ...match, category: { $ne: null } } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r: any) => [String(r._id), r.count]));
}

async function findOrFail(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Categoría no encontrada", 404);
  const category = await Category.findById(id);
  if (!category) throw new CustomError("Categoría no encontrada", 404);
  return category;
}

/** Público: activas, en el orden que definió la tienda, con conteo de productos publicados. */
export async function listPublic() {
  const [categories, counts] = await Promise.all([
    Category.find({ isActive: true }).sort({ order: 1, name: 1 }).lean(),
    countByCategory(true),
  ]);
  return categories.map((c: any) => toDto(c, counts.get(String(c._id)) || 0));
}

/** Admin: todas, con conteo de todos los productos (incluye borradores). */
export async function listAdmin() {
  const [categories, counts] = await Promise.all([
    Category.find().sort({ order: 1, name: 1 }).lean(),
    countByCategory(false),
  ]);
  return categories.map((c: any) => toDto(c, counts.get(String(c._id)) || 0));
}

function readFields(input: any, partial: boolean) {
  const data: Record<string, unknown> = {};

  if (input?.name !== undefined || !partial) {
    const name = String(input?.name ?? "").trim();
    if (!name) throw new CustomError("Escribe el nombre de la categoría", 400);
    data.name = name.slice(0, 80);
  }
  if (input?.description !== undefined) {
    data.description = String(input.description ?? "")
      .trim()
      .slice(0, 1000);
  }
  if (input?.order !== undefined) {
    const order = Number(input.order);
    if (!Number.isFinite(order)) throw new CustomError("El orden debe ser un número", 400);
    data.order = Math.round(order);
  }
  if (input?.isActive !== undefined) data.isActive = Boolean(input.isActive);

  return data;
}

export async function create(input: any) {
  const data = readFields(input, false);
  const slug = await uniqueSlug(Category, String(data.name));
  const category = await Category.create({ ...data, slug });
  return toDto(category);
}

export async function update(id: string, input: any) {
  const category = await findOrFail(id);
  const data = readFields(input, true);

  // El slug sigue al nombre: la categoría se identifica por su nombre en la URL.
  if (data.name && data.name !== category.name) {
    category.slug = await uniqueSlug(Category, String(data.name), category._id);
  }

  Object.assign(category, data);
  await category.save();
  return toDto(category);
}

export async function remove(id: string): Promise<{ ok: true }> {
  const category = await findOrFail(id);

  const products = await Product.countDocuments({ category: category._id });
  if (products > 0) {
    throw new CustomError(
      `No se puede eliminar: la categoría tiene ${products} producto${products === 1 ? "" : "s"}. Muévelos a otra categoría primero.`,
      400,
    );
  }

  if (category.imagePublicId) {
    try {
      await deleteImage(category.imagePublicId);
    } catch (error) {
      console.warn("[category] no se pudo borrar la imagen en Cloudinary:", error);
    }
  }

  await category.deleteOne();
  return { ok: true };
}

export async function setImage(id: string, file: Express.Multer.File | undefined) {
  if (!isCloudinaryConfigured()) {
    throw new CustomError(
      "La subida de imágenes no está disponible: Cloudinary no está configurado",
      503,
    );
  }
  if (!file) throw new CustomError("Selecciona una imagen", 400);
  if (!file.mimetype.startsWith("image/"))
    throw new CustomError("El archivo debe ser una imagen", 400);

  const category = await findOrFail(id);
  const previous = category.imagePublicId;

  const uploaded = await uploadBuffer(file.buffer, CATEGORY_FOLDER);
  category.image = uploaded.url;
  category.imagePublicId = uploaded.publicId;
  await category.save();

  if (previous) {
    try {
      await deleteImage(previous);
    } catch (error) {
      console.warn("[category] no se pudo borrar la imagen anterior en Cloudinary:", error);
    }
  }

  return toDto(category);
}
