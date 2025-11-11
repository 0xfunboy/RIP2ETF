/**
 * Minimal client facade: re-export from API client
 * In questo modo il server che importa "@elizaos/client"
 * trova gli stessi simboli esposti da "@elizaos/api-client".
 */
export * from "@elizaos/api-client";
