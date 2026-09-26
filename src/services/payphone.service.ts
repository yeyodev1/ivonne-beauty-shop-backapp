import axios from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

/** statusCode de Payphone en la confirmación. */
export const PAYPHONE_APPROVED = 3;
export const PAYPHONE_CANCELED = 2;

export function isPayphoneConfigured(): boolean {
  return !!(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

export function requirePayphone(): void {
  if (!isPayphoneConfigured()) {
    throw new CustomError("Los pagos en línea no están disponibles", 503);
  }
}

/** Datos que la Cajita de Pagos necesita en el navegador. */
export function boxConfig() {
  return { token: env.PAYPHONE_TOKEN, storeId: env.PAYPHONE_STORE_ID };
}

/**
 * Confirma una transacción de la Cajita de Pagos.
 * Lanza CustomError 400 con el mensaje de Payphone si la API responde error;
 * `details` lleva la respuesta cruda para guardarla en el pedido.
 */
export async function confirmTransaction(id: number, clientTxId: string): Promise<any> {
  requirePayphone();
  try {
    const { data } = await axios.post(
      CONFIRM_URL,
      { id: Number(id), clientTxId },
      {
        headers: {
          Authorization: `Bearer ${env.PAYPHONE_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      },
    );
    return data;
  } catch (error: any) {
    const body = error?.response?.data;
    const detail =
      (typeof body === "object" && (body?.message || body?.errors?.[0]?.message)) ||
      (typeof body === "string" && body) ||
      error?.message ||
      "sin respuesta";
    throw new CustomError(`No pudimos confirmar el pago con Payphone: ${detail}`, 400, {
      status: error?.response?.status ?? null,
      body: body ?? null,
      message: error?.message ?? null,
    });
  }
}
