import { Order, PAID_STATUSES } from "../models/order.model";
import { Product } from "../models/product.model";
import { User } from "../models/user.model";
import { containsRegex } from "../utils/escapeRegex";
import { paginated, parsePagination } from "../utils/pagination";
import { LOW_STOCK_THRESHOLD } from "./product.service";

// Ecuador continental es UTC-5 todo el año (sin horario de verano).
const ECUADOR_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Inicio del día y del mes en hora de Ecuador, expresados en UTC. */
function ecuadorBoundaries(now = new Date()) {
  const local = new Date(now.getTime() - ECUADOR_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  return {
    today: new Date(Date.UTC(y, m, d) + ECUADOR_OFFSET_MS),
    month: new Date(Date.UTC(y, m, 1) + ECUADOR_OFFSET_MS),
  };
}

export async function getStats() {
  const { today, month } = ecuadorBoundaries();

  const [
    ordersToday,
    pendingOrders,
    monthAgg,
    products,
    publishedProducts,
    lowStock,
    customers,
    recentOrders,
  ] = await Promise.all([
    // Pedidos cobrados hoy (los "pending" son carritos que no llegaron a pagar).
    Order.countDocuments({ status: { $in: PAID_STATUSES }, createdAt: { $gte: today } }),
    // Por atender: ya pagados y todavía no despachados.
    Order.countDocuments({ status: { $in: ["paid", "preparing"] } }),
    Order.aggregate([
      { $match: { status: { $in: PAID_STATUSES }, createdAt: { $gte: month } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$total" } } },
    ]),
    Product.countDocuments(),
    Product.countDocuments({ isPublished: true }),
    Product.countDocuments({ isPublished: true, stock: { $lte: LOW_STOCK_THRESHOLD } }),
    User.countDocuments({ accountType: "customer" }),
    Order.find().select("-payphone -__v").sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  return {
    ordersToday,
    pendingOrders,
    paidOrdersMonth: monthAgg[0]?.count || 0,
    salesMonth: monthAgg[0]?.total || 0,
    products,
    publishedProducts,
    lowStock,
    customers,
    recentOrders,
  };
}

export async function listCustomers(query: any) {
  const { page, limit, skip } = parsePagination(query, 20, 100);
  const filter: Record<string, unknown> = { accountType: "customer" };

  const q = String(query.q ?? "").trim();
  if (q) {
    const rx = containsRegex(q);
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const ids = users.map((u: any) => u._id);
  const emails = users.map((u: any) => u.email);

  // Un pedido cuenta para el usuario si lo hizo con su cuenta o como invitado con su correo.
  const orders = await Order.find({
    status: { $in: PAID_STATUSES },
    $or: [{ user: { $in: ids } }, { "customer.email": { $in: emails } }],
  })
    .select("user customer.email total")
    .lean();

  const idByEmail = new Map(users.map((u: any) => [u.email, String(u._id)]));
  const totals = new Map<string, { ordersCount: number; totalSpent: number }>();
  for (const o of orders as any[]) {
    const owner = (o.user && String(o.user)) || idByEmail.get(o.customer?.email);
    if (!owner) continue;
    const acc = totals.get(owner) || { ordersCount: 0, totalSpent: 0 };
    acc.ordersCount += 1;
    acc.totalSpent += o.total;
    totals.set(owner, acc);
  }

  const items = users.map((u: any) => {
    const id = String(u._id);
    const t = totals.get(id) || { ordersCount: 0, totalSpent: 0 };
    return {
      id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      createdAt: u.createdAt,
      ordersCount: t.ordersCount,
      totalSpent: t.totalSpent,
    };
  });

  return paginated(items, total, page, limit);
}
