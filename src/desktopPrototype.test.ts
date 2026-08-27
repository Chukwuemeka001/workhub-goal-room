import { describe, expect, it } from "vitest";
import prototypeHtml from "../design/prototypes/desktop-mission-map-v1/index.html?raw";

describe("desktop Living Goal Map prototype", () => {
  it("keeps deterministic FAIL on the failed Candidate correction frontier", () => {
    expect(prototypeHtml).toMatch(/fail:\{[^}]*stage:3[^}]*mapNode:2/);
    expect(prototypeHtml).toContain("i===s.mapNode?'active':''");
  });
});
