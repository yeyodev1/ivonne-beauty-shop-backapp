import mongoose from "mongoose";
import { CustomError } from "../errors/customError.error";
import { ACCOUNT_TYPES, AccountType, User } from "../models/user.model";
import { containsRegex } from "../utils/escapeRegex";
import { paginated, parsePagination } from "../utils/pagination";
import { createUser } from "./auth.service";

const MIN_PASSWORD = 8;

function toAdminUser(user: any) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    accountType: user.accountType,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function parseAccountType(value: unknown): AccountType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!ACCOUNT_TYPES.includes(value as AccountType)) {
    throw new CustomError("Tipo de cuenta inválido", 400);
  }
  return value as AccountType;
}

/** GET — todas las cuentas (admins y clientes). Filtros: q, accountType, page. */
export async function list(query: any) {
  const { page, limit, skip } = parsePagination(query, 20, 100);
  const filter: Record<string, unknown> = {};

  const accountType = parseAccountType(query.accountType);
  if (accountType) filter.accountType = accountType;

  const q = String(query.q ?? "").trim();
  if (q) {
    const rx = containsRegex(q);
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ accountType: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return paginated(users.map(toAdminUser), total, page, limit);
}

export async function create(body: any) {
  const email = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();
  if (!name) throw new CustomError("Escribe el nombre", 400);

  if (await User.exists({ email })) {
    throw new CustomError("Ya existe una cuenta con ese correo", 409);
  }

  const created = await createUser({
    email,
    password,
    name: name.slice(0, 120),
    phone: String(body.phone ?? "").trim().slice(0, 30),
    accountType: parseAccountType(body.accountType) ?? "customer",
  });
  return toAdminUser(await User.findById(created.id).lean());
}

/**
 * PATCH — nombre, celular, rol, activo y (opcional) nueva contraseña.
 * Una admin no puede quitarse a sí misma el rol ni desactivarse: se quedaría
 * fuera del panel sin nadie que la vuelva a habilitar.
 */
export async function update(id: string, body: any, actorId: string) {
  if (!mongoose.isValidObjectId(id)) throw new CustomError("Usuario no encontrado", 404);
  const user = await User.findById(id).select("+password");
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const isSelf = String(user._id) === actorId;

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new CustomError("Escribe el nombre", 400);
    user.name = name.slice(0, 120);
  }
  if (body.phone !== undefined) user.phone = String(body.phone).trim().slice(0, 30);

  const accountType = parseAccountType(body.accountType);
  if (accountType && accountType !== user.accountType) {
    if (isSelf) throw new CustomError("No puedes quitarte el rol de administración", 400);
    user.accountType = accountType;
  }

  if (body.isActive !== undefined) {
    const isActive = Boolean(body.isActive);
    if (isSelf && !isActive) throw new CustomError("No puedes desactivar tu propia cuenta", 400);
    user.isActive = isActive;
  }

  const password = String(body.password ?? "");
  if (password) {
    if (password.length < MIN_PASSWORD) {
      throw new CustomError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`, 400);
    }
    user.password = password;
  }

  await user.save();
  return toAdminUser(user);
}
