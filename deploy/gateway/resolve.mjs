// register.mjs's hook: @shards/<name> is packages/<name>/src/index.ts beside the gateway

export async function resolve(specifier, context, next) {
  const m = /^@shards\/([\w-]+)$/.exec(specifier);
  if (m) return { url: new URL(`./packages/${m[1]}/src/index.ts`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
