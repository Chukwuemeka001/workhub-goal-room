# Release integrity v2 evaluation

## Promise

The Owner cannot accept a release whose proof manifest belongs to different candidate bytes.

## Executable result

The deterministic evaluator attempted 22 substitutions and authority attacks, blocked all 22, recorded 0 unexpected mutations, and recorded 0 unauthorized acceptances. Its positive control reached System v2 PASS, an exact-digest completion request, explicit Owner acceptance, and terminal sealing.

`manifest.json` records the exact byte length and SHA-256 of every executable, test, report, and handoff file in this local evaluation packet.

`protectedParity.mjs` separately verifies that the unchanged Owner controller and exact six-tool WebMCP authority surface still match source base `089745dd595934147dcad71ece28097346b709c5`, while recording `goalRoom.ts` and `releaseRules.ts` as the two authorized v2 migration files. This avoids rewriting the immutable historical v3 evidence contract.

Run the evaluator and adversarial report verifier locally:

```bash
npm run eval:release-integrity-v2
npm run qa:release-protected-v2
npm run qa:production-journey-v2
```

Regenerate `report.json` only from the executable evaluator:

```bash
WRITE_RELEASE_INTEGRITY_REPORT=1 ./node_modules/.bin/vitest run --configLoader runner evaluation/release-integrity-v2/evaluator.test.ts -t "generates the deterministic JSON report"
```

## 30-second stale-proof demo

1. Submit the canonical v2 envelope with a one-character stale proof-manifest digest.
2. Show deterministic `PROOF_MANIFEST_MISMATCH` and that completion remains unavailable.
3. Submit the exact canonical envelope and show System v2 PASS.
4. Request completion for its exact candidate SHA-256 and open the Owner dialog.
5. Point to candidate, source, candidate-manifest, proof-manifest, rollback, and ruleset identities before the Owner chooses whether to seal the room.

## Trust boundary

The submitted package matched the prequalified identity tuple. WorkHub compares canonical submitted bytes and identity declarations; it does not run tests, inspect deployment bytes, measure duration, validate rollback applicability, or independently prove the manifests belong together. PASS is not Owner acceptance, and this local evaluation is neither deployment nor production-readiness proof.

## Artifact provenance gate

`provenance.mjs` hashes the actual candidate-manifest, proof-manifest, and rollback-patch byte inputs. It then validates the candidate manifest's authoritative schema: `evidencePackageManifestSha256` must equal the frozen proof digest and `rollbackPatch.sha256` must equal the frozen rollback digest. It does not invent a `proofManifest.path` field or equate an embedded source location with a local copy destination.

The exact three frozen inputs are present, so the command passes only while every byte hash and both structural references match:

```bash
npm run qa:release-provenance-v2
```

The copied candidate manifest and rollback patch under `artifacts/` are local-only provenance inputs, not publication-ready packet files. The candidate bytes retain an absolute private source-machine location. The verifier deliberately does not inspect, normalize, compare, or print that value; it reads only the authoritative digest references and emits only frozen/actual digests. Publishing either copied artifact would cross the documented boundary and would require a separately qualified replacement identity.

`manifest.json` therefore preserves the executable/report inventory separately from these two local-only inputs. Its frozen gate records `matched: true` only while the tests recompute all three exact hashes and the authoritative structural references.

## Rollback and public-change gate

Before promotion, independently run `git apply --check` on the verified rollback bytes against the declared source base in an appropriate private environment. Applying that patch, sanitizing or publishing local-only provenance inputs, reverting work, committing, pushing, deploying, editing Devpost, replacing screenshots or video, and publishing any claim all require explicit Owner approval and are outside this evaluation.

The historical `scripts/production-journey-receipt.mjs` remains byte-identical to its protected baseline. `npm run qa:production-journey-v2` writes a separate v2 receipt, requires unchanged Owner-controller, WebMCP, declarations, and tool-surface bytes, checks the exact six tool names, and records `goalRoom.ts` plus `releaseRules.ts` as the only authorized v2 migrations.
