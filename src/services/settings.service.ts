import { CustomError } from "../errors/customError.error";
import { Settings, IShippingOption } from "../models/settings.model";

const SETTINGS_KEY = "main";

export const DEFAULT_SHIPPING_OPTIONS: IShippingOption[] = [
  {
    id: "pickup",
    label: "Retiro en tienda",
    description: "Junín entre Rocafuerte y Bolívar, diagonal a la Prefectura, Machala",
    price: 0,
    enabled: true,
  },
  {
    id: "machala",
    label: "Entrega a domicilio en Machala",
    description: "Entrega en 24 a 48 horas",
    price: 250,
    enabled: true,
  },
  {
    id: "nacional",
    label: "Envío a todo Ecuador",
    description: "Servientrega, 2 a 4 días hábiles",
    price: 600,
    enabled: true,
  },
];

export const DEFAULT_ANNOUNCEMENT =
  "Maquillaje y skincare 100% original de USA · Envíos a todo Ecuador";

export interface SettingsDto {
  shippingOptions: IShippingOption[];
  announcement: string;
}

function toDto(doc: any, onlyEnabled: boolean): SettingsDto {
  const options: IShippingOption[] = (doc.shippingOptions || []).map((o: any) => ({
    id: o.id,
    label: o.label,
    description: o.description || "",
    price: o.price,
    enabled: o.enabled !== false,
  }));
  return {
    shippingOptions: onlyEnabled ? options.filter((o) => o.enabled) : options,
    announcement: doc.announcement || "",
  };
}

/**
 * Devuelve el documento único, creándolo con los valores por defecto si no existe.
 * Upsert con $setOnInsert: si dos peticiones llegan a la vez, solo una lo crea.
 */
async function getDoc() {
  return Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      $setOnInsert: {
        key: SETTINGS_KEY,
        shippingOptions: DEFAULT_SHIPPING_OPTIONS,
        announcement: DEFAULT_ANNOUNCEMENT,
      },
    },
    { upsert: true, new: true },
  );
}

/** Siembra los ajustes por defecto al arrancar. Nunca lanza. */
export async function ensureSettings(): Promise<void> {
  try {
    await getDoc();
  } catch (error) {
    console.error("[settings] no se pudieron sembrar los ajustes:", error);
  }
}

export async function getPublicSettings(): Promise<SettingsDto> {
  return toDto(await getDoc(), true);
}

export async function getAdminSettings(): Promise<SettingsDto> {
  return toDto(await getDoc(), false);
}

/** Opción de envío habilitada por id, o null. La usa el checkout. */
export async function findEnabledShippingOption(id: string): Promise<IShippingOption | null> {
  const settings = await getPublicSettings();
  return settings.shippingOptions.find((o) => o.id === id) || null;
}

export async function updateSettings(input: any): Promise<SettingsDto> {
  const current = await getDoc();
  const update: Partial<SettingsDto> = {};

  if (input?.shippingOptions !== undefined) {
    if (!Array.isArray(input.shippingOptions)) {
      throw new CustomError("Las opciones de envío deben ser una lista", 400);
    }
    const seen = new Set<string>();
    update.shippingOptions = input.shippingOptions.map((raw: any, index: number) => {
      const id = String(raw?.id ?? "").trim();
      const label = String(raw?.label ?? "").trim();
      const price = Number(raw?.price);
      if (!id) throw new CustomError(`La opción de envío ${index + 1} no tiene id`, 400);
      if (seen.has(id)) throw new CustomError(`La opción de envío "${id}" está repetida`, 400);
      seen.add(id);
      if (!label) throw new CustomError(`La opción de envío "${id}" no tiene nombre`, 400);
      if (!Number.isInteger(price) || price < 0) {
        throw new CustomError(
          `El precio de "${label}" debe ser un entero en centavos mayor o igual a 0`,
          400,
        );
      }
      return {
        id,
        label,
        description: String(raw?.description ?? "").trim(),
        price,
        enabled: raw?.enabled !== false,
      };
    });
  }

  if (input?.announcement !== undefined) {
    update.announcement = String(input.announcement ?? "")
      .trim()
      .slice(0, 300);
  }

  Object.assign(current, update);
  await current.save();
  return toDto(current, false);
}
