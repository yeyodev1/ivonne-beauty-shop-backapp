import { Request, Response, NextFunction } from "express";
import * as productService from "../services/product.service";

/** GET /api/products — query: category, q, brand, featured, sort, page, limit */
export async function listPublic(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.listPublic(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/brands */
export async function listBrands(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.listBrands());
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/:slug */
export async function getBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.getBySlug(String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/products — query: q, category, status, page, limit */
export async function listAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.listAdmin(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/products/:id */
export async function getAdminById(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.getAdminById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/products */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await productService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/products/:id */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.update(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/products/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.remove(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/products/:id/images — multipart, campo "images" (hasta 8) */
export async function addImages(req: Request, res: Response, next: NextFunction) {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    res.status(200).json(await productService.addImages(String(req.params.id), files));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/products/:id/images?publicId=...&url=... */
export async function removeImage(req: Request, res: Response, next: NextFunction) {
  try {
    const publicId = String(req.query.publicId ?? "").trim();
    const url = String(req.query.url ?? "").trim();
    res.status(200).json(await productService.removeImage(String(req.params.id), publicId, url));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/products/:id/images/order — body: { images } */
export async function reorderImages(req: Request, res: Response, next: NextFunction) {
  try {
    const images = req.body?.images;
    res.status(200).json(await productService.reorderImages(String(req.params.id), images));
  } catch (error) {
    next(error);
  }
}
