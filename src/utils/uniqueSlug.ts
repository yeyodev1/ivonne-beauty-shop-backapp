import { Model } from "mongoose";
import { slugify } from "./slugify";

/**
 * Slug único dentro de una colección. Si ya existe, agrega -2, -3...
 * `excludeId` evita que un documento choque consigo mismo al editarlo.
 */
export async function uniqueSlug(
  model: Model<any>,
  text: string,
  excludeId?: unknown,
): Promise<string> {
  const base = slugify(text).replace(/^-+|-+$/g, "") || "item";
  const exclude = excludeId ? { _id: { $ne: excludeId } } : {};

  let slug = base;
  let n = 2;
  while (await model.exists({ slug, ...exclude })) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}
