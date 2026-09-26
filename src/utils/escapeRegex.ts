/** Escapa un texto del usuario para usarlo dentro de un RegExp sin que cambie su sentido. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Búsqueda "contiene", sin distinguir mayúsculas. */
export function containsRegex(input: string): RegExp {
  return new RegExp(escapeRegex(input.trim()), "i");
}
