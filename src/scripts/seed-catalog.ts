/**
 * Carga el catálogo de la tienda desde un JSON.
 * Uso: pnpm seed:catalog <ruta/products.json> [--stock=10]
 *
 * Formato: [{ name, brand, category, price (USD, número o null), description,
 * image: "images/archivo.jpg" relativo al JSON }]
 *
 * Es idempotente: busca por slug del nombre antes de crear, y no vuelve a
 * subir la foto de un producto que ya tiene imágenes. Un producto sin precio
 * queda como borrador para que la tienda lo complete desde el panel.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Category } from "../models/category.model";
import { Product } from "../models/product.model";
import { slugify } from "../utils/slugify";
import { isCloudinaryConfigured, uploadImage } from "../services/cloudinary.service";

interface CatalogItem {
  name: string;
  brand?: string;
  category?: string;
  price?: number | null;
  description?: string;
  image?: string;
}

// Nombre visible y orden de cada categoría del JSON.
const CATEGORIES: Record<string, { name: string; order: number }> = {
  maquillaje: { name: "Maquillaje", order: 1 },
  rostro: { name: "Rostro", order: 2 },
  ojos: { name: "Ojos", order: 3 },
  labios: { name: "Labios", order: 4 },
  skincare: { name: "Skincare", order: 5 },
  perfumes: { name: "Perfumes", order: 6 },
  cabello: { name: "Cabello", order: 7 },
  sets: { name: "Sets y regalos", order: 8 },
  bolsos: { name: "Bolsos", order: 9 },
  accesorios: { name: "Accesorios", order: 10 },
};

const FOLDER = "ivonne-beauty-shop/products";

async function ensureCategory(key: string) {
  const slug = slugify(key || "maquillaje");
  const meta = CATEGORIES[slug] ?? { name: key, order: 99 };
  const existing = await Category.findOne({ slug });
  if (existing) return existing;
  return Category.create({ name: meta.name, slug, order: meta.order, isActive: true });
}

async function uploadCover(file: string, slug: string) {
  if (!fs.existsSync(file)) {
    console.warn(`  ! imagen no encontrada: ${file}`);
    return [];
  }
  const { url, publicId } = await uploadImage(file, FOLDER);
  console.log(`  ↑ ${slug} → Cloudinary`);
  return [{ url, publicId }];
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("✖ Uso: pnpm seed:catalog <ruta/products.json> [--stock=10]");
    process.exit(1);
  }
  const stockArg = process.argv.find((a) => a.startsWith("--stock="));
  const defaultStock = stockArg ? Number(stockArg.split("=")[1]) : 10;

  if (!isCloudinaryConfigured()) {
    console.error("✖ Cloudinary no está configurado en .env");
    process.exit(1);
  }

  const baseDir = path.dirname(path.resolve(jsonPath));
  const items: CatalogItem[] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  await mongoose.connect(env.DB_URI);
  console.log(`Cargando ${items.length} productos...`);

  let created = 0;
  let updated = 0;
  let drafts = 0;

  for (const item of items) {
    const slug = slugify(item.name).replace(/^-+|-+$/g, "");
    if (!slug) continue;

    const category = await ensureCategory(item.category || "maquillaje");
    const hasPrice = typeof item.price === "number" && item.price > 0;
    const price = hasPrice ? Math.round((item.price as number) * 100) : 0;
    if (!hasPrice) drafts += 1;

    const fields = {
      name: item.name.trim(),
      brand: (item.brand || "").trim(),
      category: category._id,
      description: (item.description || "").trim(),
      price,
    };

    const existing = await Product.findOne({ slug });
    if (existing) {
      Object.assign(existing, fields);
      if (!existing.images.length && item.image) {
        existing.images = await uploadCover(path.join(baseDir, item.image), slug);
      }
      await existing.save();
      updated += 1;
      continue;
    }

    const images = item.image ? await uploadCover(path.join(baseDir, item.image), slug) : [];
    await Product.create({
      ...fields,
      slug,
      images,
      stock: defaultStock,
      isPublished: hasPrice,
      isFeatured: false,
    });
    created += 1;
  }

  console.log(`✔ Creados: ${created} · Actualizados: ${updated} · Borradores sin precio: ${drafts}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló la carga del catálogo:", error);
  process.exit(1);
});
