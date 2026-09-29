import { Resend } from "resend";
import { env } from "../config/env";

const BRAND = "#e4007c";

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

/**
 * Envía un correo. Nunca lanza: el fallo de un correo no debe romper el
 * flujo que lo disparó (una compra, un registro). Devuelve si Resend lo aceptó.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY no definida — no se envió "${subject}" a ${to}`);
    return false;
  }

  try {
    const { error } = await client.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, html });
    if (error) {
      console.error("[email] Resend rechazó el envío:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] send failed:", error);
    return false;
  }
}

/** Plantilla base: tarjeta blanca centrada con encabezado de marca. */
export function layout(title: string, body: string): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:Arial,Helvetica,sans-serif">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden">
        <tr><td style="background:${BRAND};color:#fff;padding:20px 32px;font-size:18px;font-weight:bold">Ivonne Beauty Shop</td></tr>
        <tr><td style="padding:32px;color:#111;font-size:15px;line-height:1.6">
          <h1 style="margin:0 0 16px;font-size:22px">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;color:#71717a;font-size:12px">© ${new Date().getFullYear()} Ivonne Beauty Shop · Machala, Ecuador</td></tr>
      </table>
    </td></tr>
  </table>`;
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

/** Lo mínimo del pedido que usan las plantillas; evita acoplar este archivo al modelo. */
export interface OrderEmailData {
  number: string;
  customer: { name: string; email: string; phone: string; documentId: string };
  items: {
    name: string;
    brand: string;
    price: number;
    quantity: number;
    shade?: { name: string } | null;
  }[];
  subtotal: number;
  shippingCost: number;
  total: number;
  shipping: { optionId: string; label: string };
  address: { city: string; street: string; reference: string };
  notes: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0 0"><a href="${href}" style="background:${BRAND};color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:bold;display:inline-block">${label}</a></p>`;
}

function itemsTable(order: OrderEmailData): string {
  const rows = order.items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5">
          ${escapeHtml(i.name)}${i.shade?.name ? `<br><span style="color:#71717a;font-size:13px">Tono: ${escapeHtml(i.shade.name)}</span>` : ""}${i.brand ? `<br><span style="color:#71717a;font-size:13px">${escapeHtml(i.brand)}</span>` : ""}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:center">${i.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:right">${formatMoney(i.price * i.quantity)}</td>
      </tr>`,
    )
    .join("");

  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:16px 0">
    <tr style="color:#71717a;font-size:12px;text-transform:uppercase">
      <td style="padding-bottom:6px">Producto</td>
      <td style="padding-bottom:6px;text-align:center">Cant.</td>
      <td style="padding-bottom:6px;text-align:right">Total</td>
    </tr>
    ${rows}
    <tr><td colspan="2" style="padding-top:12px">Subtotal</td><td style="padding-top:12px;text-align:right">${formatMoney(order.subtotal)}</td></tr>
    <tr><td colspan="2">Envío (${escapeHtml(order.shipping.label)})</td><td style="text-align:right">${order.shippingCost ? formatMoney(order.shippingCost) : "Gratis"}</td></tr>
    <tr><td colspan="2" style="padding-top:8px;font-weight:bold;font-size:16px">Total</td><td style="padding-top:8px;text-align:right;font-weight:bold;font-size:16px;color:${BRAND}">${formatMoney(order.total)}</td></tr>
  </table>`;
}

function deliveryBlock(order: OrderEmailData): string {
  if (order.shipping.optionId === "pickup") {
    return `<p style="margin:16px 0 0"><strong>Entrega:</strong> ${escapeHtml(order.shipping.label)}. Junín entre Rocafuerte y Bolívar, diagonal a la Prefectura, Machala.</p>`;
  }
  const { city, street, reference } = order.address;
  return `<p style="margin:16px 0 0"><strong>Entrega:</strong> ${escapeHtml(order.shipping.label)}<br>
    ${escapeHtml(street)}${city ? `, ${escapeHtml(city)}` : ""}${reference ? `<br><span style="color:#71717a">Referencia: ${escapeHtml(reference)}</span>` : ""}</p>`;
}

/** Al cliente: pago aprobado. */
export function sendOrderConfirmedEmail(order: OrderEmailData): Promise<boolean> {
  const body = `
    <p>Hola ${escapeHtml(order.customer.name)}, recibimos tu pago. Tu pedido <strong>${escapeHtml(order.number)}</strong> está confirmado y ya lo estamos preparando.</p>
    ${itemsTable(order)}
    ${deliveryBlock(order)}
    <p style="margin:16px 0 0">Te avisaremos por correo cuando tu pedido salga. Si tienes dudas, responde a este correo.</p>
    ${button(env.FRONTEND_URL, "Ir a la tienda")}`;
  return sendEmail(
    order.customer.email,
    `Pedido ${order.number} confirmado · Ivonne Beauty Shop`,
    layout("¡Gracias por tu compra!", body),
  );
}

/** A la tienda (ADMIN_EMAIL): llegó un pedido pagado. */
export function sendNewOrderToStoreEmail(order: OrderEmailData): Promise<boolean> {
  const c = order.customer;
  const body = `
    <p>Entró un pedido pagado por <strong>${formatMoney(order.total)}</strong>.</p>
    <p style="margin:16px 0 0"><strong>Cliente:</strong> ${escapeHtml(c.name)}<br>
      Correo: ${escapeHtml(c.email)}<br>
      Teléfono: ${escapeHtml(c.phone)}${c.documentId ? `<br>Cédula/RUC: ${escapeHtml(c.documentId)}` : ""}</p>
    ${itemsTable(order)}
    ${deliveryBlock(order)}
    ${order.notes ? `<p style="margin:16px 0 0"><strong>Notas:</strong> ${escapeHtml(order.notes)}</p>` : ""}
    ${button(`${env.FRONTEND_URL}/admin`, "Ver en el panel")}`;
  return sendEmail(
    env.ADMIN_EMAIL,
    `Nuevo pedido ${order.number} · ${formatMoney(order.total)}`,
    layout(`Nuevo pedido ${escapeHtml(order.number)}`, body),
  );
}

/** Al cliente: el pedido salió o fue entregado. */
export function sendOrderStatusEmail(
  order: OrderEmailData,
  status: "shipped" | "delivered",
): Promise<boolean> {
  const pickup = order.shipping.optionId === "pickup";
  const title =
    status === "shipped"
      ? pickup
        ? "Tu pedido está listo para retirar"
        : "Tu pedido va en camino"
      : "Tu pedido fue entregado";
  const intro =
    status === "shipped"
      ? pickup
        ? `Tu pedido <strong>${escapeHtml(order.number)}</strong> ya está listo. Puedes retirarlo en nuestra tienda.`
        : `Tu pedido <strong>${escapeHtml(order.number)}</strong> ya salió y está en camino.`
      : `Tu pedido <strong>${escapeHtml(order.number)}</strong> fue entregado. ¡Esperamos que lo disfrutes!`;
  const body = `
    <p>Hola ${escapeHtml(order.customer.name)}, ${intro}</p>
    ${itemsTable(order)}
    ${deliveryBlock(order)}
    ${button(env.FRONTEND_URL, "Seguir comprando")}`;
  return sendEmail(order.customer.email, `${title} · Pedido ${order.number}`, layout(title, body));
}
