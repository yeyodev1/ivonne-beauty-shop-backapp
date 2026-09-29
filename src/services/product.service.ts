import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Category } from "../models/category.model";
import { IProductImage, IProductShade, Product } from "../models/product.model";
import { containsRegex, escapeRegex } from "../utils/escapeRegex";
import { paginated, parsePagination } from "../utils/pagination";
import { uniqueSlug } from "../utils/uniqueSlug";
import { deleteImage, isCloudinaryConfigured, uploadBuffer } from "./cloudinary.service";

const PRODUCT_FOLDER = "ivonne-beauty-shop/products";
const CATEGORY_FIELDS = "name slug description image order isActive";
export const LOW_STOCK_THRESHOLD = 3;
const MAX_SHADES = 60;
const HEX = /^#[0-9a-f]{6}$/i;

const SORTS: Record<string, Record<string, 1 | -1>> = {
  new: { createdAt: -1 },
  "price-asc": { price: 1, createdAt: -1 },
  "price-desc": { price: -1, createdAt: -1 },
  name: { name: 1 },
};

function toDto(doc: any) {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.__v;
  return obj;
}

async function findOrFail(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Producto no encontrado", 404);
  const product = await Product.findById(id);
  if (!product) throw new CustomError("Producto no encontrado", 404);
  return product;
}

async function populated(id: unknown) {
  const product = await Product.findById(id).populate("category", CATEGORY_FIELDS).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);
  return toDto(product);
}

// ---------------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------------

export async function listPublic(query: any) {
  const { page, limit, skip } = parsePagination(query, 24, 60);
  const filter: Record<string, unknown> = { isPublished: true };

  const categorySlug = String(query.category ?? "").trim();
  if (categorySlug) {
    const category = await Category.findOne({ slug: categorySlug }).select("_id").lean();
    if (!category) return paginated([], 0, page, limit);
    filter.category = (category as any)._id;
  }

  const q = String(query.q ?? "").trim();
  if (q) {
    const rx = containsRegex(q);
    filter.$or = [{ name: rx }, { brand: rx }, { tags: rx }];
  }

  const brand = String(query.brand ?? "").trim();
  if (brand) filter.brand = new RegExp(`^${escapeRegex(brand)}$`, "i");

  if (String(query.featured ?? "") === "true") filter.isFeatured = true;

  const sort = SORTS[String(query.sort ?? "")] || SORTS.new;

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("category", CATEGORY_FIELDS)
      .lean(),
    Product.countDocuments(filter),
  ]);

  return paginated(items.map(toDto), total, page, limit);
}

export async function listBrands(): Promise<string[]> {
  const brands: string[] = await Product.distinct("brand", { isPublished: true });
  return brands
    .map((b) => String(b).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

export async function getBySlug(slug: string) {
  const product: any = await Product.findOne({ slug, isPublished: true })
    .populate("category", CATEGORY_FIELDS)
    .lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);

  const categoryId = product.category?._id;
  const related = categoryId
    ? await Product.find({ category: categoryId, isPublished: true, _id: { $ne: product._id } })
        .sort({ isFeatured: -1, createdAt: -1 })
        .limit(8)
        .populate("category", CATEGORY_FIELDS)
        .lean()
    : [];

  return { product: toDto(product), related: related.map(toDto) };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listAdmin(query: any) {
  const { page, limit, skip } = parsePagination(query, 24, 100);
  const filter: Record<string, unknown> = {};

  const q = String(query.q ?? "").trim();
  if (q) {
    const rx = containsRegex(q);
    filter.$or = [{ name: rx }, { brand: rx }, { slug: rx }];
  }

  const category = String(query.category ?? "").trim();
  if (category) {
    if (!isValidObjectId(category)) return paginated([], 0, page, limit);
    filter.category = category;
  }

  const status = String(query.status ?? "").trim();
  if (status === "published") filter.isPublished = true;
  else if (status === "draft") filter.isPublished = false;
  else if (status === "out") filter.stock = { $lte: 0 };

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("category", CATEGORY_FIELDS)
      .lean(),
    Product.countDocuments(filter),
  ]);

  return paginated(items.map(toDto), total, page, limit);
}

export async function getAdminById(id: string) {
  const product = await findOrFail(id);
  return populated(product._id);
}

function toCents(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new CustomError(`${label} debe ser un entero en centavos mayor o igual a 0`, 400);
  }
  return n;
}

function readImages(value: unknown): IProductImage[] {
  if (!Array.isArray(value)) throw new CustomError("Las imágenes deben ser una lista", 400);
  return value
    .map((img: any) =>
      typeof img === "string"
        ? { url: img.trim(), publicId: "" }
        : { url: String(img?.url ?? "").trim(), publicId: String(img?.publicId ?? "").trim() },
    )
    .filter((img) => img.url);
}

/** Conserva el _id de cada tono existente: los carritos abiertos lo referencian. */
function readShades(value: unknown): IProductShade[] {
  if (!Array.isArray(value)) throw new CustomError("Los tonos deben ser una lista", 400);
  if (value.length > MAX_SHADES) {
    throw new CustomError(`Un producto puede tener hasta ${MAX_SHADES} tonos`, 400);
  }

  const seen = new Set<string>();
  return value.map((raw: any) => {
    const name = String(raw?.name ?? "")
      .trim()
      .slice(0, 60);
    if (!name) throw new CustomError("Cada tono necesita un nombre", 400);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new CustomError(`El tono "${name}" está repetido`, 400);
    seen.add(key);

    const color = String(raw?.color ?? "").trim();
    const stock = Number(raw?.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0) {
      throw new CustomError(
        `El stock del tono "${name}" debe ser un entero mayor o igual a 0`,
        400,
      );
    }

    const shade: IProductShade = {
      name,
      color: HEX.test(color) ? color.toLowerCase() : "",
      stock,
      isActive: raw?.isActive === undefined ? true : Boolean(raw.isActive),
    };
    if (raw?._id && isValidObjectId(raw._id)) shade._id = raw._id;
    return shade;
  });
}

async function readFields(input: any, partial: boolean) {
  const data: Record<string, unknown> = {};
  const has = (key: string) => input?.[key] !== undefined;

  if (has("name") || !partial) {
    const name = String(input?.name ?? "").trim();
    if (!name) throw new CustomError("Escribe el nombre del producto", 400);
    data.name = name.slice(0, 160);
  }
  if (has("brand"))
    data.brand = String(input.brand ?? "")
      .trim()
      .slice(0, 80);
  if (has("description")) data.description = String(input.description ?? "").trim();

  if (has("category")) {
    const category = input.category;
    const id = typeof category === "object" && category ? category._id : category;
    if (!id) {
      data.category = null;
    } else {
      if (!isValidObjectId(id) || !(await Category.exists({ _id: id }))) {
        throw new CustomError("La categoría no existe", 400);
      }
      data.category = id;
    }
  }

  if (has("price") || !partial) data.price = toCents(input?.price, "El precio");
  if (has("compareAtPrice")) {
    const v = input.compareAtPrice;
    data.compareAtPrice = v === null || v === "" ? null : toCents(v, "El precio anterior");
  }
  if (has("stock") || !partial) {
    const stock = input?.stock === undefined ? 0 : Number(input.stock);
    if (!Number.isInteger(stock) || stock < 0) {
      throw new CustomError("El stock debe ser un número entero mayor o igual a 0", 400);
    }
    data.stock = stock;
  }

  if (has("isPublished")) data.isPublished = Boolean(input.isPublished);
  if (has("isFeatured")) data.isFeatured = Boolean(input.isFeatured);

  if (has("tags")) {
    const raw = Array.isArray(input.tags) ? input.tags : String(input.tags ?? "").split(",");
    data.tags = [
      ...new Set(raw.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean)),
    ];
  }

  if (has("images")) data.images = readImages(input.images);
  // El stock del producto lo recalcula el modelo al guardar cuando hay tonos.
  if (has("shades")) data.shades = readShades(input.shades);

  return data;
}

export async function create(input: any) {
  const data = await readFields(input, false);
  const slug = await uniqueSlug(Product, String(data.name));
  const product = await Product.create({ ...data, slug });
  return populated(product._id);
}

/** El slug no cambia al renombrar: los enlaces ya compartidos (WhatsApp, Instagram) siguen funcionando. */
export async function update(id: string, input: any) {
  const product = await findOrFail(id);
  const data = await readFields(input, true);
  Object.assign(product, data);
  await product.save();
  return populated(product._id);
}

export async function remove(id: string): Promise<{ ok: true }> {
  const product = await findOrFail(id);

  for (const img of product.images as IProductImage[]) {
    if (!img.publicId) continue;
    try {
      await deleteImage(img.publicId);
    } catch (error) {
      console.warn("[product] no se pudo borrar la imagen en Cloudinary:", error);
    }
  }

  await product.deleteOne();
  return { ok: true };
}

export async function addImages(id: string, files: Express.Multer.File[] | undefined) {
  if (!isCloudinaryConfigured()) {
    throw new CustomError(
      "La subida de imágenes no está disponible: Cloudinary no está configurado",
      503,
    );
  }
  if (!files || files.length === 0) throw new CustomError("Selecciona al menos una imagen", 400);
  if (files.some((f) => !f.mimetype.startsWith("image/"))) {
    throw new CustomError("Todos los archivos deben ser imágenes", 400);
  }

  const product = await findOrFail(id);
  const uploaded = await Promise.all(files.map((f) => uploadBuffer(f.buffer, PRODUCT_FOLDER)));

  product.images.push(...uploaded);
  await product.save();
  return populated(product._id);
}

export async function removeImage(id: string, publicId: string, url: string) {
  if (!publicId && !url) throw new CustomError("Indica qué imagen quieres quitar", 400);

  const product = await findOrFail(id);
  const images = product.images as IProductImage[];
  const matches = (img: IProductImage) =>
    (publicId && img.publicId === publicId) || (url && img.url === url);

  const target = images.find(matches);
  if (!target) throw new CustomError("Imagen no encontrada", 404);

  if (target.publicId) {
    try {
      await deleteImage(target.publicId);
    } catch (error) {
      console.warn("[product] no se pudo borrar la imagen en Cloudinary:", error);
    }
  }

  product.images = images.filter((img) => !matches(img));
  await product.save();
  return populated(product._id);
}

/** Reordena sin permitir colar imágenes nuevas: solo acepta las que ya tiene el producto. */
export async function reorderImages(id: string, input: unknown) {
  const product = await findOrFail(id);
  const current = product.images as IProductImage[];
  const next = readImages(input);

  const byUrl = new Map(current.map((img) => [img.url, img]));
  const sameSet =
    next.length === current.length &&
    new Set(next.map((i) => i.url)).size === next.length &&
    next.every((img) => byUrl.has(img.url));
  if (!sameSet) {
    throw new CustomError("La lista de imágenes no coincide con las del producto", 400);
  }

  product.images = next.map((img) => {
    const original = byUrl.get(img.url)!;
    return { url: original.url, publicId: original.publicId };
  });
  await product.save();
  return populated(product._id);
}
