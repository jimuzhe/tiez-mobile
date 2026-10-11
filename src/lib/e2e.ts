import * as Crypto from 'expo-crypto';
import {
  type E2eKeys,
  type E2eKind,
  sealMqttTextWithNonce,
  sealWithNonce,
  toHex,
} from './e2eCore';

export * from './e2eCore';

// Hermes has no crypto.getRandomValues; expo-crypto supplies the randomness.
const randomBytes = (length: number) => Crypto.getRandomBytes(length);

export function seal(keys: E2eKeys, kind: E2eKind, plaintext: Uint8Array) {
  return sealWithNonce(keys, kind, plaintext, randomBytes(12));
}

/** An MQTT payload for the desktop: the usual JSON message, sealed. */
export function sealMqttMessage(keys: E2eKeys, message: Record<string, unknown>) {
  const json = JSON.stringify({ ...message, id: toHex(randomBytes(8)) });
  return sealMqttTextWithNonce(keys, json, randomBytes(12));
}
