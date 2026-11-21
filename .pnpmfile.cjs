// The inspected drizzle-kit 0.30.6 runtime bundles its schema/config loader.
// Its executable JS files do not import this deprecated manifest-only loader.
// Scope the correction to this exact version; re-check on future upgrades.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "drizzle-kit" && pkg.version === "0.30.6" && pkg.dependencies) {
        delete pkg.dependencies["@esbuild-kit/esm-loader"];
      }
      return pkg;
    },
  },
};
