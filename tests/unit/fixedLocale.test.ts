import { describe, expect, it } from "vitest";

// The unit tests run under en-US whatever the machine's own locale (tests/fixtures/fixedLocale.ts).
// Each value below is one that a German or Swedish locale formats or orders differently, so a gap in
// that setup shows here before it shows as a stray failure elsewhere.
describe("the unit tests' locale", () => {
  it("formats numbers and dates the en-US way when no locale is given", () => {
    expect((97968.5).toLocaleString()).toBe("97,968.5");
    expect(12345678n.toLocaleString()).toBe("12,345,678");
    expect([1234, 5678].toLocaleString()).toBe("1,234,5,678");
    const date = new Date(Date.UTC(2026, 0, 2, 15, 4, 5));
    expect(date.toLocaleDateString(undefined, { timeZone: "UTC" })).toBe("1/2/2026");
    expect(date.toLocaleTimeString(undefined, { timeZone: "UTC" })).toBe("3:04:05 PM");
    expect(date.toLocaleString(undefined, { timeZone: "UTC" })).toBe("1/2/2026, 3:04:05 PM");
  });

  it("orders strings the en-US way when no locale is given", () => {
    expect("ä".localeCompare("z")).toBe(-1);
  });

  it("starts every Intl formatter at en-US, called with or without new", () => {
    expect(new Intl.NumberFormat().format(1234.5)).toBe("1,234.5");
    expect(Intl.NumberFormat().format(1234.5)).toBe("1,234.5");
    expect(Intl.DateTimeFormat().resolvedOptions().locale).toBe("en-US");
    expect(new Intl.Collator().resolvedOptions().locale).toBe("en-US");
    // ICU reports PluralRules' locale as plain "en", so its English ordinals are checked instead.
    expect(new Intl.PluralRules(undefined, { type: "ordinal" }).select(2)).toBe("two");
    expect(new Intl.RelativeTimeFormat().resolvedOptions().locale).toBe("en-US");
    expect(new Intl.ListFormat().resolvedOptions().locale).toBe("en-US");
    expect(new Intl.Segmenter().resolvedOptions().locale).toBe("en-US");
    expect(new Intl.DisplayNames(undefined, { type: "region" }).of("DE")).toBe("Germany");
    expect(new Intl.NumberFormat()).toBeInstanceOf(Intl.NumberFormat);
  });

  it("leaves a locale that is asked for alone", () => {
    expect((97968.5).toLocaleString("de-DE")).toBe("97.968,5");
    expect(new Intl.NumberFormat("de-DE").format(1234.5)).toBe("1.234,5");
    expect("ä".localeCompare("z", "sv")).toBe(1);
  });
});
