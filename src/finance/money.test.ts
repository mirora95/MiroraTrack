import { describe, expect, it } from "vitest";

import {
  currencyCode,
  currencyFractionDigits,
  formatMinor,
  isSupportedCurrency,
  parseMajor,
  parseSignedMajor,
  SUPPORTED_CURRENCY_CODES,
} from "./money";

describe("Tajikistani somoni", () => {
  it("is a supported currency", () => {
    expect(isSupportedCurrency("TJS")).toBe(true);
    expect(SUPPORTED_CURRENCY_CODES).toContain("TJS");
  });

  it("uses two minor units, because one somoni is one hundred diram", () => {
    expect(currencyFractionDigits("TJS")).toBe(2);
  });

  it("parses and formats without floating point drift", () => {
    expect(parseMajor("1234.56", currencyFractionDigits("TJS"))).toBe(123456);
    // Intl separates a currency code from the amount with U+00A0, not a space.
    expect(formatMinor(123456, "TJS", "en-US")).toBe("TJS 1,234.56");
  });
});

describe("parseMajor", () => {
  it.each([
    ["10.29", 2, 1029],
    ["0", 2, 0],
    ["  0.5  ", 2, 50],
    ["42", 0, 42],
    ["12.345", 3, 12345],
  ])("parses %j at scale %i as %i minor units", (text, scale, expected) => {
    expect(parseMajor(text, scale)).toBe(expected);
  });

  it.each([".5", "10.", "00", "01", "+1", "-1", "1,000", "1e2", "one", "1..2"])(
    "rejects malformed major-unit text %j",
    (text) => {
      expect(() => parseMajor(text, 2)).toThrow(RangeError);
    },
  );

  it("rejects fractional text when the scale is zero", () => {
    expect(() => parseMajor("1.0", 0)).toThrow(RangeError);
  });

  it("rejects a fraction longer than the scale", () => {
    expect(() => parseMajor("1.234", 2)).toThrow(RangeError);
  });

  it.each([-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid fraction digit scale %s",
    (scale) => {
      expect(() => parseMajor("1", scale)).toThrow(RangeError);
    },
  );

  it("rejects a result outside the safe integer range", () => {
    expect(() => parseMajor("9007199254740992", 0)).toThrow(RangeError);
    expect(() => parseMajor("90071992547409.92", 2)).toThrow(RangeError);
  });
});

describe("parseSignedMajor", () => {
  it.each([
    ["10.29", 2, 1029],
    ["-10.29", 2, -1029],
    ["-0", 2, 0],
    ["0", 0, 0],
  ] as const)("parses %s exactly", (text, fractionDigits, expected) => {
    expect(parseSignedMajor(text, fractionDigits)).toBe(expected);
  });

  it.each(["+1", "1,000", "1e3", "1 0", "1.234"])(
    "rejects noncanonical input %s",
    (text) => {
      expect(() => parseSignedMajor(text, 2)).toThrow(RangeError);
    },
  );

  it("rejects signed overflow", () => {
    expect(() => parseSignedMajor("-90071992547409.92", 2)).toThrow(RangeError);
  });
});

describe("currencyFractionDigits", () => {
  it("uses currency metadata from Intl.NumberFormat", () => {
    expect(currencyFractionDigits("USD")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KWD")).toBe(3);
  });

  it.each(["", "US", "USDX", "12A"])(
    "consistently rejects malformed currency %j",
    (currency) => {
      expect(() => currencyFractionDigits(currency)).toThrow(RangeError);
    },
  );
});

describe("currencyCode", () => {
  it("returns a validated well-formed currency code", () => {
    expect(currencyCode("USD")).toBe("USD");
    expect(currencyCode("ZZZ")).toBe("ZZZ");
  });

  it("rejects malformed currency text", () => {
    expect(() => currencyCode("usd")).toThrow(RangeError);
  });
});

describe("formatMinor", () => {
  it("formats positive and signed minor units using the currency scale", () => {
    expect(formatMinor(1029, "USD", "en-US")).toBe("$10.29");
    expect(formatMinor(-1029, "USD", "en-US")).toBe("-$10.29");
    expect(formatMinor(1234, "JPY", "ja-JP")).toBe("￥1,234");
  });

  it("preserves exact cents at the safe-integer boundaries", () => {
    expect(formatMinor(Number.MAX_SAFE_INTEGER, "USD", "en-US")).toBe(
      "$90,071,992,547,409.91",
    );
    expect(formatMinor(Number.MIN_SAFE_INTEGER, "USD", "en-US")).toBe(
      "-$90,071,992,547,409.91",
    );
  });

  it("preserves the sign for negative amounts below one major unit", () => {
    expect(formatMinor(-1, "USD", "en-US")).toBe("-$0.01");
    expect(formatMinor(-99, "USD", "en-US")).toBe("-$0.99");
  });

  it("emits exactly one locale-positioned sign for larger negative amounts", () => {
    expect(formatMinor(-1029, "USD", "en-US")).toBe("-$10.29");
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 9007199254740992])(
    "rejects unsafe minor amount %s",
    (amount) => {
      expect(() => formatMinor(amount, "USD", "en-US")).toThrow(RangeError);
    },
  );

  it("rejects malformed currencies with RangeError", () => {
    expect(() => formatMinor(100, "US", "en-US")).toThrow(RangeError);
  });
});
