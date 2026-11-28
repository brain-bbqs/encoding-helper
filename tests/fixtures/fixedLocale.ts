// Vitest setup file: gives the built-ins that format or compare by locale en-US as their default,
// so a figure the app formats with a bare toLocaleString() reads the same in the unit tests on any
// machine. Vitest runs it inside each worker before the test file, so the app's modules only ever
// see the wrapped built-ins.
//
// It is done here rather than through LC_ALL or LANG because Node's ICU takes its default locale
// from those variables only on Linux and macOS. On Windows it asks the user's regional settings,
// which no environment variable overrides. Wrapping the built-ins themselves holds on all three.
// A call that names a locale is passed through untouched.

const LOCALE = "en-US";

/** The built-in methods that format or compare by the default locale, and where their locales
 * argument sits. */
const LOCALE_METHODS: [owner: object, name: string, localesAt: number][] = [
  [Number.prototype, "toLocaleString", 0],
  [BigInt.prototype, "toLocaleString", 0],
  [Date.prototype, "toLocaleString", 0],
  [Date.prototype, "toLocaleDateString", 0],
  [Date.prototype, "toLocaleTimeString", 0],
  [String.prototype, "localeCompare", 1],
];

/** The Intl constructors, each of which takes its locales first. */
const INTL_CONSTRUCTORS = [
  "Collator",
  "DateTimeFormat",
  "DisplayNames",
  "ListFormat",
  "NumberFormat",
  "PluralRules",
  "RelativeTimeFormat",
  "Segmenter",
];

function withLocaleAt(args: unknown[], at: number): unknown[] {
  if (args[at] !== undefined) return args;
  const filled = [...args];
  filled[at] = LOCALE;
  return filled;
}

function pinDefaultLocale(): void {
  for (const [owner, name, localesAt] of LOCALE_METHODS) {
    const original: unknown = Reflect.get(owner, name);
    if (typeof original !== "function") continue;
    Reflect.set(owner, name, function (this: unknown, ...args: unknown[]): unknown {
      return Reflect.apply(original, this, withLocaleAt(args, localesAt));
    });
  }
  for (const name of INTL_CONSTRUCTORS) {
    const original: unknown = Reflect.get(Intl, name);
    if (typeof original !== "function") continue;
    // A proxy rather than a subclass, so the constructor still works without `new`, as the
    // built-ins do, and keeps its static methods and its prototype for instanceof.
    Reflect.set(
      Intl,
      name,
      new Proxy(original, {
        construct: (target, args, newTarget) => Reflect.construct(target, withLocaleAt(args, 0), newTarget),
        apply: (target, thisArg, args) => Reflect.apply(target, thisArg, withLocaleAt(args, 0)),
      }),
    );
  }
}

// A worker that runs several files without isolation runs this file once per file; one layer of
// wrapping is enough.
const PINNED = Symbol.for("encoding-helper.fixedLocale");
if (!Reflect.get(globalThis, PINNED)) {
  Reflect.set(globalThis, PINNED, true);
  pinDefaultLocale();
}
