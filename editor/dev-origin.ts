/**
 * Décide de l'en-tête Origin à transmettre au serveur de l'éditeur depuis le proxy Vite.
 * Seule l'origine exacte du serveur de développement est réécrite vers celle du serveur ;
 * toute autre origine est laissée telle quelle (le serveur répond alors 403).
 */
export function rewriteOrigin(incoming: string | undefined, devOrigins: string[], backend: string): string | undefined {
  if (incoming === undefined) return undefined
  return devOrigins.includes(incoming) ? backend : incoming
}
