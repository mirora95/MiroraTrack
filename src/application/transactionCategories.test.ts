import { describe, expect, it } from "vitest";

import {
  MAX_CUSTOM_CATEGORY_LENGTH,
  categoryFor,
  categoryLabel,
  categoryOptions,
  customCategoryId,
  isCustomCategoryId,
  parseCustomCategory,
} from "./transactionCategories";

const control = String.fromCharCode(0);

describe("custom categories", () => {
  it("keeps built-in categories resolvable", () => {
    expect(categoryFor("food", "expense")?.label).toBe("Food");
    expect(categoryFor("food", "income")).toBeUndefined();
    expect(isCustomCategoryId("food")).toBe(false);
  });

  it("round-trips a custom category through its identifier", () => {
    const id = customCategoryId("Pet care", "expense");
    expect(id).toBe("custom:expense:pet care");
    expect(categoryFor(id!, "expense")).toEqual({
      id,
      label: "Pet care",
      type: "expense",
    });
    expect(categoryLabel(id!)).toBe("Pet care");
  });

  it("maps equivalent names onto one identifier so budgets and transactions meet", () => {
    const canonical = customCategoryId("Pet care", "expense");
    for (const variant of ["pet care", "  PET   CARE  ", "Pet Care"]) {
      expect(customCategoryId(variant, "expense")).toBe(canonical);
    }
  });

  it("separates the income and expense namespaces", () => {
    const id = customCategoryId("Side gig", "income")!;
    expect(categoryFor(id, "income")?.label).toBe("Side gig");
    expect(categoryFor(id, "expense")).toBeUndefined();
  });

  it("rejects names that cannot be encoded", () => {
    expect(customCategoryId("   ", "expense")).toBeUndefined();
    expect(customCategoryId("a:b", "expense")).toBeUndefined();
    expect(customCategoryId(`a${control}b`, "expense")).toBeUndefined();
    expect(
      customCategoryId("x".repeat(MAX_CUSTOM_CATEGORY_LENGTH + 1), "expense"),
    ).toBeUndefined();
  });

  it("stays inside the 64 character ceiling other validators enforce", () => {
    const id = customCategoryId(
      "x".repeat(MAX_CUSTOM_CATEGORY_LENGTH),
      "expense",
    )!;
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it("refuses malformed identifiers rather than inventing a label", () => {
    for (const value of [
      "custom:",
      "custom:expense:",
      "custom:savings:pet care",
      "custom:expense:Pet care",
      "custom:expense: pet care",
    ]) {
      expect(parseCustomCategory(value)).toBeUndefined();
      expect(categoryLabel(value)).toBe("Other");
    }
  });

  it("lists built-ins first and then the custom ones in use", () => {
    const zebra = customCategoryId("Zebra", "expense")!;
    const pets = customCategoryId("Pet care", "expense")!;
    const income = customCategoryId("Side gig", "income")!;
    const options = categoryOptions("expense", [zebra, pets, income, pets]);

    expect(options[0]?.id).toBe("housing");
    expect(options.slice(-2).map((item) => item.label)).toEqual([
      "Pet care",
      "Zebra",
    ]);
    expect(options.filter((item) => item.id === pets)).toHaveLength(1);
    expect(options.some((item) => item.id === income)).toBe(false);
  });
});
