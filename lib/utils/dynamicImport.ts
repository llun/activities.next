export const dynamicImport = async <T>(specifier: string): Promise<T> => {
  if (process.env.VITEST) {
    return import(/* @vite-ignore */ specifier) as Promise<T>
  }
  // Use new Function so bundlers (Turbopack/Webpack) do not attempt to statically
  // resolve optional workspace dependencies at build time when they are not installed.
  const importer = new Function('specifier', 'return import(specifier)')
  return importer(specifier) as Promise<T>
}
