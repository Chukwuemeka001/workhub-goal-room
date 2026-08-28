import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const PATH_BROWSER_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
];

function defaultMacosApplicationPaths(env) {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    env.HOME && join(env.HOME, "Applications/BrowserOS.app/Contents/MacOS/BrowserOS"),
  ].filter(Boolean);
}

function isExecutableFile(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBrowserExecutable({
  env = process.env,
  macosApplicationPaths = defaultMacosApplicationPaths(env),
} = {}) {
  const pathDirectories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const pathCandidate = PATH_BROWSER_NAMES
    .flatMap((name) => pathDirectories.map((directory) => join(directory, name)))
    .find(isExecutableFile);
  const browserPath = [env.CHROME_BIN, pathCandidate, ...macosApplicationPaths]
    .find(isExecutableFile);
  if (!browserPath) {
    throw new Error("Set CHROME_BIN to a Chromium-compatible browser executable");
  }
  return browserPath;
}
