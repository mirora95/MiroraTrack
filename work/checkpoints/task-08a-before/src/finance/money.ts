import { minorAmount } from "./types";
import type { CurrencyCode, MinorAmount } from "./types";

export function currencyCode(value: string): CurrencyCode {
  currencyFractionDigits(value);
  return value as CurrencyCode;
}

function assertFractionDigits(fractionDigits: number): void {
  if (
    !Number.isInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 6
  ) {
    throw new RangeError("Fraction digits must be an integer from 0 to 6");
  }
}

export function parseMajor(
  text: string,
  fractionDigits: number,
): MinorAmount {
  assertFractionDigits(fractionDigits);
  const normalized = text.trim();
  const pattern =
    fractionDigits === 0
      ? /^(?:0|[1-9]\d*)$/
      : new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${fractionDigits}})?$`);

  if (!pattern.test(normalized)) {
    throw new RangeError("Invalid major-unit amount");
  }

  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = fraction.padEnd(fractionDigits, "0");
  const scale = 10n ** BigInt(fractionDigits);
  const result = BigInt(whole) * scale + BigInt(paddedFraction || "0");

  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Minor-unit amount exceeds the safe integer range");
  }

  return minorAmount(Number(result));
}

export function currencyFractionDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RangeError("Currency must be a three-letter uppercase code");
  }

  try {
    const fractionDigits = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    if (fractionDigits === undefined) {
      throw new RangeError("Currency fraction digits are unavailable");
    }
    assertFractionDigits(fractionDigits);
    return fractionDigits;
  } catch {
    throw new RangeError("Invalid currency code");
  }
}

export function formatMinor(
  amount: number,
  currency: CurrencyCode | string,
  locale: string,
): string {
  const validatedAmount = minorAmount(amount);
  const fractionDigits = currencyFractionDigits(currency);
  const scale = 10n ** BigInt(fractionDigits);
  const minorUnits = BigInt(validatedAmount);
  const isNegative = minorUnits < 0n;
  const absoluteMinorUnits = isNegative ? -minorUnits : minorUnits;
  const absoluteWholeUnits = absoluteMinorUnits / scale;
  const fraction = absoluteMinorUnits % scale;

  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    const fractionText = fraction.toString().padStart(fractionDigits, "0");
    const wholeUnitsForFormatting =
      isNegative && absoluteWholeUnits === 0n
        ? -0
        : isNegative
          ? -absoluteWholeUnits
          : absoluteWholeUnits;

    return formatter
      .formatToParts(wholeUnitsForFormatting)
      .map((part) => (part.type === "fraction" ? fractionText : part.value))
      .join("");
  } catch {
    throw new RangeError("Invalid currency or locale");
  }
}
