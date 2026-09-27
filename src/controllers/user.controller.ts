import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as userService from "../services/user.service";

/** GET /api/admin/users — query: q, accountType, page */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await userService.list(req.query));
  } catch (error) {
    next(error);
  }
}

/** POST /api/admin/users — body: { name, email, password, phone, accountType } */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await userService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/users/:id — body: { name, phone, accountType, isActive, password } */
export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json(await userService.update(String(req.params.id), req.body ?? {}, req.user?.userId ?? ""));
  } catch (error) {
    next(error);
  }
}
