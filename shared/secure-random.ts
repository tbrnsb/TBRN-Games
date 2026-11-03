import { randomInt } from "node:crypto";

/**
 * Fisher-Yates shuffle using crypto-secure randomInt
 */
export function secureShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Secure random choice from array
 */
export function secureChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)];
}

/**
 * Secure random integer in range [min, max)
 */
export function secureRandomInt(min: number, max: number): number {
  return randomInt(min, max);
}

/**
 * Secure random float in range [0, 1)
 * Uses 53 bits of entropy from two randomInt calls
 */
export function secureRandom(): number {
  const high = randomInt(0, 0x200000); // 21 bits
  const low = randomInt(0, 0x100000000); // 32 bits
  return (high * 0x100000000 + low) / 0x20000000000000;
}