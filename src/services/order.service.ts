import crypto from "crypto";
import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Counter } from "../models/counter.model";
import { ORDER_STATUSES, Order, OrderStatus, PAID_STATUSES } from "../models/order.model";
import { Product } from "../models/product.model";
import { User } from "../models/user.model";
import { containsRegex } from "../utils/escapeRegex";
import { paginated, parsePagination } from "../utils/pagination";
import {
  sendNewOrderToStoreEmail,
  sendOrderConfirmedEmail,
  sendOrderStatusEmail,
} from "./email.service";
import {
  PAYPHONE_APPROVED,
  PAYPHONE_CANCELED,
  boxConfig,
  confirmTransaction,
  requirePayphone,
} from "./payphone.service";
import { findEnabledShippingOption } from "./settings.service";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_QUANTITY = 20;
const MAX_LINES = 50;
const PICKUP = "pickup";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Respuesta pública: nunca expone la respuesta cruda de Payphone. */
function toPublic(doc: any) {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.payphone;
  delete obj.__v;
  return obj;
}

function toAdmin(doc: any) {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.__v;
  return obj;
}

async function nextOrderNumber(): Promise<string> {
  const counter = await Counter.findOneAndUpdate(
    { _id: "order" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `IB-${String(counter.seq).padStart(6, "0")}`;
}

/** Único y de ≤ 50 caracteres, que es el tope de Payphone para clientTransactionId. */
function newClientTransactionId(): string {
  const random = crypto.randomBytes(4).toString("hex");
  return `IB-${Date.now().toString(36)}-${random}`.toUpperCase();
}

function text(value: unknown, max: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

type StockLine = { product: unknown; quantity: number; shade?: { id: unknown } | null };

/** Descuenta stock sin bajar de 0, en una sola operación atómica por línea. */
async function applyStock(items: StockLine[]): Promise<void> {
  await Promise.all(
    items.map((item) => {
      if (!item.shade?.id) {
        return Product.updateOne({ _id: item.product }, [
          { $set: { stock: { $max: [0, { $subtract: ["$stock", item.quantity] }] } } },
        ]);
      }
      // Con tono: se descuenta del tono y el stock del producto se vuelve a sumar de los tonos activos.
      return Product.updateOne({ _id: item.product }, [
        {
          $set: {
            shades: {
              $map: {
                input: "$shades",
                as: "s",
                in: {
                  $cond: [
                    { $eq: ["$$s._id", item.shade.id] },
                    {
                      $mergeObjects: [
                        "$$s",
                        { stock: { $max: [0, { $subtract: ["$$s.stock", item.quantity] }] } },
                      ],
                    },
                    "$$s",
                  ],
                },
              },
            },
          },
        },
        {
          $set: {
            stock: {
              $sum: {
                $map: {
                  input: { $filter: { input: "$shades", as: "s", cond: "$$s.isActive" } },
                  as: "s",
                  in: "$$s.stock",
                },
              },
            },
          },
        },
      ]);
    }),
  );
}

async function notifyPaid(order: any): Promise<void> {
  await Promise.allSettled([sendOrderConfirmedEmail(order), sendNewOrderToStoreEmail(order)]);
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export async function createOrder(input: any, userId: string | null) {
  // Antes que nada: sin Payphone no tiene sentido dejar un pedido creado.
  requirePayphone();

  // Líneas: se agrupan por producto y tono para que nadie esquive el tope repitiendo la línea.
  if (!Array.isArray(input?.items) || input.items.length === 0) {
    throw new CustomError("Tu carrito está vacío", 400);
  }
  if (input.items.length > MAX_LINES)
    throw new CustomError("El pedido tiene demasiados productos", 400);

  const quantities = new Map<string, number>();
  for (const line of input.items) {
    const productId = String(line?.productId ?? "");
    const shadeId = String(line?.shadeId ?? "");
    const quantity = Number(line?.quantity);
    if (!isValidObjectId(productId) || (shadeId && !isValidObjectId(shadeId)))
      throw new CustomError("Hay un producto inválido en el carrito", 400);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new CustomError(
        `La cantidad de cada producto debe estar entre 1 y ${MAX_QUANTITY}`,
        400,
      );
    }
    const key = `${productId}:${shadeId}`;
    quantities.set(key, (quantities.get(key) || 0) + quantity);
  }
  for (const quantity of quantities.values()) {
    if (quantity > MAX_QUANTITY) {
      throw new CustomError(
        `Puedes llevar hasta ${MAX_QUANTITY} unidades de cada producto o tono`,
        400,
      );
    }
  }

  // Cliente
  const customer = {
    name: text(input?.customer?.name, 120),
    email: text(input?.customer?.email, 160).toLowerCase(),
    phone: text(input?.customer?.phone, 30),
    documentId: text(input?.customer?.documentId, 20),
  };
  if (!customer.name) throw new CustomError("Escribe tu nombre", 400);
  if (!EMAIL.test(customer.email)) throw new CustomError("Escribe un correo válido", 400);
  if (!customer.phone) throw new CustomError("Escribe tu número de teléfono", 400);

  // Envío
  const optionId = text(input?.shippingOptionId, 60);
  const option = optionId ? await findEnabledShippingOption(optionId) : null;
  if (!option) throw new CustomError("Elige una opción de envío válida", 400);

  const address = {
    city: text(input?.address?.city, 80),
    street: text(input?.address?.street, 200),
    reference: text(input?.address?.reference, 200),
  };
  if (option.id !== PICKUP) {
    if (!address.street) throw new CustomError("Escribe la dirección de entrega", 400);
    if (!address.city) {
      if (option.id === "machala") address.city = "Machala";
      else throw new CustomError("Escribe la ciudad de entrega", 400);
    }
  }

  // Productos: precios, nombres y stock salen de la base, nunca del cliente.
  const productIds = [...new Set([...quantities.keys()].map((key) => key.split(":")[0]))];
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const byId = new Map(products.map((p: any) => [String(p._id), p]));

  const items = [...quantities.entries()].map(([key, quantity]) => {
    const [productId, shadeId] = key.split(":");
    const product: any = byId.get(productId);
    if (!product || !product.isPublished) {
      throw new CustomError("Uno de los productos de tu carrito ya no está disponible", 400);
    }

    const shades: any[] = product.shades || [];
    let shade: any = null;
    let stock: number = product.stock;
    let label: string = product.name;
    if (shades.length > 0) {
      if (!shadeId) throw new CustomError(`Elige un tono de ${product.name}`, 400);
      shade = shades.find((s) => String(s._id) === shadeId);
      if (!shade || !shade.isActive) {
        throw new CustomError(
          `El tono ${shade?.name ? `${shade.name} ` : ""}de ${product.name} ya no está disponible`,
          400,
        );
      }
      stock = shade.stock;
      label = `${product.name} (tono ${shade.name})`;
    }

    if (stock <= 0) throw new CustomError(`${label} está agotado`, 400);
    if (stock < quantity) {
      throw new CustomError(
        `Solo quedan ${stock} unidad${stock === 1 ? "" : "es"} de ${label}`,
        400,
      );
    }
    return {
      product: product._id,
      name: product.name,
      slug: product.slug,
      brand: product.brand || "",
      image: product.images?.[0]?.url || "",
      price: product.price,
      quantity,
      shade: shade ? { id: shade._id, name: shade.name, color: shade.color || "" } : null,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const shippingCost = option.price;
  const total = subtotal + shippingCost;
  if (total <= 0) throw new CustomError("El total del pedido debe ser mayor a cero", 400);

  const order = await Order.create({
    number: await nextOrderNumber(),
    user: userId && isValidObjectId(userId) ? userId : null,
    customer,
    items,
    subtotal,
    shippingCost,
    total,
    shipping: { optionId: option.id, label: option.label },
    address: option.id === PICKUP ? { city: "", street: "", reference: "" } : address,
    notes: text(input?.notes, 500),
    clientTransactionId: newClientTransactionId(),
    status: "pending",
  });

  const { token, storeId } = boxConfig();
  return {
    order: toPublic(order),
    payphone: {
      token,
      storeId,
      clientTransactionId: order.clientTransactionId,
      amount: total,
      // La tienda no desglosa IVA: todo el monto va como "sin impuestos".
      amountWithoutTax: total,
      currency: "USD",
      reference: `Pedido ${order.number} Ivonne Beauty Shop`.slice(0, 100),
    },
  };
}

/**
 * Confirma el pago con Payphone. Idempotente: si el pedido ya no está pendiente
 * se devuelve tal cual, sin volver a descontar stock ni mandar correos.
 */
export async function confirmPayment(id: unknown, clientTransactionId: unknown) {
  const txId = String(clientTransactionId ?? "").trim();
  const payphoneId = Number(id);
  if (!txId) throw new CustomError("Falta el identificador de la transacción", 400);
  if (!Number.isFinite(payphoneId) || payphoneId <= 0) {
    throw new CustomError("Identificador de pago inválido", 400);
  }

  const order = await Order.findOne({ clientTransactionId: txId });
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (order.status !== "pending") return { order: toPublic(order) };

  let data: any;
  try {
    data = await confirmTransaction(payphoneId, txId);
  } catch (error: any) {
    await Order.updateOne(
      { _id: order._id },
      { $set: { payphone: { error: error?.details ?? error?.message ?? null, at: new Date() } } },
    );
    throw error;
  }

  if (data?.statusCode === PAYPHONE_APPROVED) {
    if (Number(data.amount) !== order.total) {
      await Order.updateOne({ _id: order._id }, { $set: { payphone: data } });
      throw new CustomError(
        "El monto cobrado no coincide con el total del pedido. Escríbenos para revisarlo.",
        400,
      );
    }

    // El filtro por "pending" garantiza que solo una confirmación concurrente aplique el pago.
    const paid = await Order.findOneAndUpdate(
      { _id: order._id, status: "pending" },
      { $set: { status: "paid", paidAt: new Date(), payphone: data } },
      { new: true },
    );
    if (!paid) {
      const current = await Order.findById(order._id);
      return { order: toPublic(current) };
    }

    await applyStock(paid.items);
    await notifyPaid(paid);
    return { order: toPublic(paid) };
  }

  if (data?.statusCode === PAYPHONE_CANCELED) {
    const canceled = await Order.findOneAndUpdate(
      { _id: order._id, status: "pending" },
      { $set: { status: "canceled", payphone: data } },
      { new: true },
    );
    return { order: toPublic(canceled || (await Order.findById(order._id))) };
  }

  // Cualquier otro estado: se guarda y el pedido sigue pendiente.
  const updated = await Order.findByIdAndUpdate(
    order._id,
    { $set: { payphone: data } },
    { new: true },
  );
  return { order: toPublic(updated) };
}

export async function getByTransaction(clientTransactionId: string) {
  const order = await Order.findOne({ clientTransactionId: String(clientTransactionId).trim() });
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return { order: toPublic(order) };
}

/**
 * Consulta pública de un pedido de invitada: correo + número.
 * Solo el correo no basta: cualquiera que lo conozca vería dirección y celular.
 * Acepta el número con o sin prefijo ("IB-000012", "000012" o "12").
 */
export async function lookup(email: unknown, number: unknown) {
  const mail = String(email ?? "")
    .toLowerCase()
    .trim();
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!mail || !digits) {
    throw new CustomError("Escribe tu correo y el número de tu pedido", 400);
  }

  const order = await Order.findOne({
    number: `IB-${digits.slice(-6).padStart(6, "0")}`,
    "customer.email": mail,
  }).select("-payphone");
  // Mismo mensaje si el número existe con otro correo: no se filtran pedidos ajenos.
  if (!order) {
    throw new CustomError("No encontramos un pedido con ese correo y ese número", 404);
  }
  return { order: toPublic(order) };
}

/** Pedidos del usuario, incluidos los que hizo como invitado con el mismo correo. */
export async function listMine(userId: string) {
  const user = await User.findById(userId).select("email").lean();
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const orders = await Order.find({
    $or: [{ user: userId }, { "customer.email": (user as any).email }],
  })
    .select("-payphone")
    .sort({ createdAt: -1 })
    .lean();
  return orders.map(toPublic);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listAdmin(query: any) {
  const { page, limit, skip } = parsePagination(query, 20, 100);
  const filter: Record<string, unknown> = {};

  const status = String(query.status ?? "").trim();
  if (status) {
    if (!ORDER_STATUSES.includes(status as OrderStatus)) {
      throw new CustomError("Estado de pedido inválido", 400);
    }
    filter.status = status;
  }

  const q = String(query.q ?? "").trim();
  if (q) {
    const rx = containsRegex(q);
    filter.$or = [{ number: rx }, { "customer.name": rx }, { "customer.email": rx }];
  }

  // La lista no trae la respuesta de Payphone: pesa y solo sirve en el detalle.
  const [items, total] = await Promise.all([
    Order.find(filter).select("-payphone").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);

  return paginated(items.map(toAdmin), total, page, limit);
}

async function findOrFail(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Pedido no encontrado", 404);
  const order = await Order.findById(id);
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return order;
}

export async function getAdminById(id: string) {
  return toAdmin(await findOrFail(id));
}

export async function updateStatus(id: string, status: unknown) {
  const next = String(status ?? "") as OrderStatus;
  if (!ORDER_STATUSES.includes(next)) throw new CustomError("Estado de pedido inválido", 400);

  const order = await findOrFail(id);
  const previous = order.status as OrderStatus;
  if (previous === next) return toAdmin(order);

  // paidAt marca que el stock ya se descontó. Si el admin da por pagado un pedido
  // (p. ej. transferencia), se descuenta aquí una sola vez.
  const becomesPaid = PAID_STATUSES.includes(next) && !order.paidAt;

  order.status = next;
  if (becomesPaid) order.paidAt = new Date();
  await order.save();

  if (becomesPaid) await applyStock(order.items);
  if (next === "shipped" || next === "delivered") {
    await sendOrderStatusEmail(order, next);
  }

  return toAdmin(order);
}
