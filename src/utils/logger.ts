export default function logger(prefix: string) {
  return Object.keys(console).reduce(
    (a, v) => ({
      ...a,
      [v]: (...args: any[]) => {
        if (typeof (console as any)[v] === "function") {
          (console as any)[v](`[${prefix}.${v}]:`, ...args);
        }
      }
    }),
    {},
  );
}