/** Written by the web app build (vite.config.ts): the path of each built file and its SHA-256 as "sha256-<base64>". */
declare module "*/dist/app-manifest.json" {
  const manifest: Record<string, string>;
  export default manifest;
}

/** Written by the web app build (vite.config.ts, finishkit.build.ts): the finish scripts by file name, as text. */
declare module "*/dist/finish-kit.json" {
  const files: Record<string, string>;
  export default files;
}
