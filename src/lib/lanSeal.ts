import * as Crypto from 'expo-crypto';
import { sealLanWithNonce } from './lanSealCore';

export * from './lanSealCore';

// Hermes has no crypto.getRandomValues; expo-crypto supplies the nonces.
export const sealLan = (key: Uint8Array, kind: string, plain: Uint8Array) =>
  sealLanWithNonce(key, kind, plain, Crypto.getRandomBytes(12));
