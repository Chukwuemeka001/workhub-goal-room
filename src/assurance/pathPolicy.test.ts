import { describe, expect, it } from "vitest";
import {
  LOCAL_V1_PATH_POLICY_SUMMARY,
  LOCAL_V1_PATH_POLICY_VERSION,
  isDependencyConventionPath,
  isDocumentationConventionPath,
  isMigrationConventionPath,
  isProductionConfigConventionPath,
  isSensitivePathLocalV1,
  isWorkflowConventionPath,
  projectTouchedPathsLocalV1,
} from "./pathPolicy";

describe("shared local-v1 path policy", () => {
  it("freezes exact convention boundaries and sensitive-policy parity", () => {
    expect(LOCAL_V1_PATH_POLICY_VERSION).toBe("local-v1");
    expect(LOCAL_V1_PATH_POLICY_SUMMARY).toContain("local-v1");
    for (const path of ["docs/guide.ts", "README", "nested/readme.MD", "x/CHANGELOG.txt", "guide.adoc"]) expect(isDocumentationConventionPath(path)).toBe(true);
    for (const path of ["src/readmeish.txt", "document/file.ts"]) expect(isDocumentationConventionPath(path)).toBe(false);
    for (const path of ["migrations/one.ts", "db/001_add.sql", "x/database/22-fix.SQL"]) expect(isMigrationConventionPath(path)).toBe(true);
    for (const path of ["db/001.sql", "db/001x.sql", "other/001_add.sql"]) expect(isMigrationConventionPath(path)).toBe(false);
    for (const path of ["package.json", "nested/Poetry.Lock", "requirements-dev.txt", "flake.lock"]) expect(isDependencyConventionPath(path)).toBe(true);
    for (const path of ["package.json.bak", "requirements.txt.bak", "requirements-.txt"]) expect(isDependencyConventionPath(path)).toBe(false);
    for (const path of [".github/workflows/a.yml", ".gitlab-ci.yml", ".gitlab/ci/a.yml", "x/Jenkinsfile"]) expect(isWorkflowConventionPath(path)).toBe(true);
    for (const path of ["nested/.gitlab-ci.yml", ".github/workflow/a.yml"]) expect(isWorkflowConventionPath(path)).toBe(false);
    for (const path of [".env.production", "config/test.json", "x/service-prod.yaml", "production.toml"]) expect(isProductionConfigConventionPath(path)).toBe(true);
    for (const path of ["x/productionish.yaml", "x/preproduction.yaml", "x/prodigy.json", "x/prod.ts"]) expect(isProductionConfigConventionPath(path)).toBe(false);
    for (const family of ["auth", "authentication", "authorization", "permissions", "iam", "rbac", "acl", "security", "migration", "migrations", "schema", "infra", "infrastructure", "deploy", "ci", "cd", "pipeline", "pipelines", "workflow", "workflows", "secret", "secrets", "config"]) {
      expect(isSensitivePathLocalV1(`src/${family}/value.ts`)).toBe(true);
      expect(isSensitivePathLocalV1(`src/${family}.TS`)).toBe(true);
    }
    for (const path of [".github/workflows/a.yml", "nested/.env", "x/.env.prod", "x/custom.lock", "x/custom.lockfile", "x/package-lock.json", "x/packages.lock.json", "x/package.resolved", "x/npm-shrinkwrap.json", "x/pnpm-lock.yaml", "x/bun.lockb", "x/go.sum"]) expect(isSensitivePathLocalV1(path)).toBe(true);
    for (const path of ["src/author/value.ts", "src/configurable.ts", "x/custom.locked", ".github/workflowish/a.yml"]) expect(isSensitivePathLocalV1(path)).toBe(false);
  });

  it("projects every destination plus rename source but never copy source", () => {
    expect(projectTouchedPathsLocalV1([
      { path: "added.ts", status: "A" },
      { path: "deleted.ts", status: "D" },
      { path: "renamed.ts", oldPath: "auth/old.ts", status: "R" },
      { path: "copied.ts", oldPath: "secrets/source.ts", status: "C" },
    ])).toEqual(["added.ts", "deleted.ts", "renamed.ts", "auth/old.ts", "copied.ts"]);
  });
});
