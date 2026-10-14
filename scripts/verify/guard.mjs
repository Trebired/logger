import assert from "node:assert/strict";

import { createLog, registerLogGroupGuard, resetLogGroupGuardForTests } from "../../dist/index.js";

function collectClaims(prefixes) {
  const claims = [];
  registerLogGroupGuard({ check: (claim) => claims.push(claim), prefixes });
  return claims;
}

function logger() {
  return createLog({ console: false, prefix: false, save: false, source: "@example/fixture" });
}

function verifyGuardSeesReservedGroupsOnly() {
  const claims = collectClaims(["example"]);
  const log = logger();
  log.info("example.one", "first");
  log.info("other.two", "second");
  log.info("example", "third");
  assert.deepEqual(claims.map((claim) => claim.group), ["example.one", "example"]);
  assert.equal(claims[0].source, "@example/fixture", "a claim carries the source that made it");
  assert.equal(claims[0].level, "info", "and the level it was made at");
  resetLogGroupGuardForTests();
}

function verifyGuardSeesTheFinishedGroup() {
  const claims = collectClaims(["example"]);
  const log = logger();
  log.info(["exa", "mple"].join("") + ".built", "assembled at runtime");
  assert.deepEqual(claims.map((claim) => claim.group), ["example.built"], "a group built from pieces is still read");
  resetLogGroupGuardForTests();
}

function verifyGuardRefusalReachesTheCaller() {
  registerLogGroupGuard({
      check: (claim) => {
        throw new Error(`refused ${claim.group}`);
      },
      prefixes: ["example"],
  });
  const log = logger();
  assert.throws(() => log.info("example.one", "first"), /refused example\.one/u, "a refusal stops the call");
  log.info("other.two", "second");
  resetLogGroupGuardForTests();
}

function verifyNoGuardLeavesRecordsAlone() {
  resetLogGroupGuardForTests();
  const log = logger();
  log.info("example.one", "a record nothing guards");
  log.warn("example.two", "and another");
}

function verifyGuardUnregisters() {
  const claims = collectClaims(["example"]);
  const release = registerLogGroupGuard({ check: (claim) => claims.push(claim), prefixes: ["example"] });
  release();
  logger().info("example.one", "first");
  assert.deepEqual(claims, [], "a released guard sees nothing");
}

verifyGuardSeesReservedGroupsOnly();
verifyGuardSeesTheFinishedGroup();
verifyGuardRefusalReachesTheCaller();
verifyNoGuardLeavesRecordsAlone();
verifyGuardUnregisters();

const log = createLog({ console: true, save: false });
log.info("verify.guard", "Log group guard verification succeeded.");
