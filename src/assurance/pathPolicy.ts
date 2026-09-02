export const LOCAL_V1_PATH_POLICY_VERSION = "local-v1" as const;

export const LOCAL_V1_PATH_POLICY_SUMMARY = "local-v1: ASCII case-insensitive path conventions cover documentation (doc/docs, standard document basenames, md/mdx/rst/adoc), migrations, recognized dependency manifests/lockfiles, workflow paths, conservative production configuration, and ACA-sensitive auth/security/migration/schema/infra/deploy/CI/CD/pipeline/workflow/secret/config families; destinations and deletions are touched, rename sources are touched, copy sources are not.";

const DEPENDENCY_BASENAMES = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "deno.json", "deno.jsonc", "deno.lock", "pyproject.toml", "poetry.lock", "uv.lock", "pipfile", "pipfile.lock", "requirements.txt", "cargo.toml", "cargo.lock", "go.mod", "go.sum", "composer.json", "composer.lock", "gemfile", "gemfile.lock", "package.swift", "package.resolved", "pubspec.yaml", "pubspec.lock", "pom.xml", "build.gradle", "build.gradle.kts", "gradle.lockfile", "packages.lock.json", "flake.nix", "flake.lock",
]);
const SENSITIVE_NAMES = new Set([
  "auth", "authentication", "authorization", "permissions", "iam", "rbac", "acl", "security", "migration", "migrations", "schema", "infra", "infrastructure", "deploy", "ci", "cd", "pipeline", "pipelines", "workflow", "workflows", "secret", "secrets", "config",
]);
const ACA_LOCKFILE_BASENAMES = new Set(["packages.lock.json", "package.resolved", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "bun.lockb", "go.sum"]);
const parts = (path: string) => path.toLowerCase().split("/");
const basename = (path: string) => parts(path).at(-1) ?? "";

export function isDocumentationConventionPath(path: string): boolean {
  const segments = parts(path), base = segments.at(-1) ?? "";
  return segments.some((segment) => segment === "doc" || segment === "docs")
    || /^(?:readme|changelog|contributing|license)(?:\..*)?$/.test(base)
    || /\.(?:md|mdx|rst|adoc)$/.test(base);
}

export function isMigrationConventionPath(path: string): boolean {
  const segments = parts(path), base = segments.at(-1) ?? "";
  return segments.some((segment) => segment === "migration" || segment === "migrations")
    || (segments.slice(0, -1).some((segment) => segment === "db" || segment === "database") && /^\d+[_-].+\.sql$/.test(base));
}

export function isDependencyConventionPath(path: string): boolean {
  const base = basename(path);
  return DEPENDENCY_BASENAMES.has(base) || /^requirements-.+\.txt$/.test(base);
}

export function isWorkflowConventionPath(path: string): boolean {
  const segments = parts(path), base = segments.at(-1) ?? "";
  return (segments[0] === ".github" && segments[1] === "workflows" && segments.length > 2)
    || (segments.length === 1 && base === ".gitlab-ci.yml")
    || (segments[0] === ".gitlab" && segments[1] === "ci" && segments.length > 2)
    || (segments[0] === ".circleci" && segments.length > 1)
    || (segments.length === 1 && (base === "azure-pipelines.yml" || base === "bitbucket-pipelines.yml"))
    || base === "jenkinsfile";
}

export function isProductionConfigConventionPath(path: string): boolean {
  const segments = parts(path), base = segments.at(-1) ?? "";
  return base === ".env" || base.startsWith(".env.")
    || segments.some((segment) => segment === "config" || segment === "configs")
    || (/(?:^|[._-])(?:prod|production)(?:[._-]|$)/.test(base.replace(/\.(?:json|ya?ml|toml|ini|conf|config|properties)$/, ""))
      && /\.(?:json|ya?ml|toml|ini|conf|config|properties)$/.test(base));
}

export function isSensitivePathLocalV1(path: string): boolean {
  const segments = parts(path), base = segments.at(-1) ?? "";
  const stem = base.includes(".") ? base.slice(0, base.indexOf(".")) : base;
  return segments.some((segment) => SENSITIVE_NAMES.has(segment))
    || SENSITIVE_NAMES.has(stem)
    || (segments[0] === ".github" && segments[1] === "workflows")
    || base === ".env" || base.startsWith(".env.")
    || base.endsWith(".lock") || base.endsWith(".lockfile") || ACA_LOCKFILE_BASENAMES.has(base);
}

export function projectTouchedPathsLocalV1(rows: readonly { path: string; status: string; oldPath?: string }[]): string[] {
  return rows.flatMap((row) => row.status === "R" && row.oldPath !== undefined ? [row.path, row.oldPath] : [row.path]);
}
