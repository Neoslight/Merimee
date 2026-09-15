/**
 * Declaration de types pour `tests/serveur.mjs`, laisse en JavaScript simple
 * (partage avec audit-visuel.mjs et apercu-social.mjs, hors de tout
 * `tsconfig`). Sans cette ombre, `svelte-check` tenterait de typer ce fichier
 * — jamais fait jusqu'ici, faute d'importeur `.ts` — et remonterait les
 * `any` implicites d'un utilitaire de test qui n'a pas a en porter la
 * rigueur.
 */
declare module '../serveur.mjs' {
  import type { Server } from 'node:http';

  export function demarrer(
    racine: string,
    port?: number
  ): Promise<{
    serveur: Server;
    octets: Map<string, number>;
    journal: string[];
    url: string;
  }>;
}
