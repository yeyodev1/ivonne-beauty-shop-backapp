import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import * as orderService from "../services/order.service";

/** POST /api/orders — Bearer opcional; body: { items, customer, shippingOptionId, address, notes? } */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await orderService.createOrder(req.body ?? {}, req.user?.userId ?? null);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/confirm — body: { id, clientTransactionId } */
export async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, clientTransactionId } = req.body ?? {};
    res.status(200).json(await orderService.confirmPayment(id, clientTransactionId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/mine */
export async function mine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new CustomError("No autorizado", 401);
    res.status(200).json(await orderService.listMine(req.user.userId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/by-transaction/:clientTransactionId */
export async function byTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const clientTransactionId = String(req.params.clientTransactionId);
    res.status(200).json(await orderService.getByTransaction(clientTransactionId));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/orders — query: status, q, page, limit */
export async function listAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.listAdmin(req.query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/admin/orders/:id */
export async function getAdminById(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.getAdminById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** PATCH /api/admin/orders/:id/status — body: { status } */
export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await orderService.updateStatus(String(req.params.id), req.body?.status);
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}
