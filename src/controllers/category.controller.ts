import { Request, Response, NextFunction } from "express";
import * as categoryService from "../services/category.service";

/** GET /api/categories */
export async function listPublic(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await categoryService.listPublic());
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/categories */
export async function listAdmin(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await categoryService.listAdmin());
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/categories — body: { name, description, order, isActive } */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await categoryService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/admin/categories/:id */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await categoryService.update(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/admin/categories/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await categoryService.remove(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/categories/:id/image — multipart, campo "image" */
export async function setImage(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await categoryService.setImage(String(req.params.id), req.file));
  } catch (error) {
    next(error);
  }
}
