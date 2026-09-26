import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";

/**
 * Como authMiddleware, pero nunca corta la petición: si hay un Bearer válido deja
 * req.user; si no hay o está vencido, sigue como invitado (p. ej. comprar sin cuenta).
 */
export function optionalAuthMiddleware(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(authHeader.split(" ")[1], env.JWT_SECRET) as JwtPayload;
    } catch {
      req.user = undefined;
    }
  }

  next();
}
