import assert from "node:assert/strict";
import {
  DESKTOP_DEPLOYMENT_MODES,
  normalizeDeploymentMode,
  topologyForMode,
  validateTopologyConfiguration,
} from "../desktop/runtime-topology.mjs";

assert.equal(normalizeDeploymentMode(" OFFICE-HOST "), DESKTOP_DEPLOYMENT_MODES.OFFICE_HOST);
assert.throws(() => normalizeDeploymentMode("hosted-by-nautex"), /Unsupported/);

assert.deepEqual(topologyForMode("standalone"), {
  mode: "standalone",
  managesBackend: true,
  managesDatabase: true,
  acceptsOfficeClients: false,
  sharedDataset: false,
});
assert.deepEqual(topologyForMode("office-host"), {
  mode: "office-host",
  managesBackend: true,
  managesDatabase: true,
  acceptsOfficeClients: true,
  sharedDataset: true,
});
assert.equal(topologyForMode("office-client").sharedDataset, true);

assert.deepEqual(validateTopologyConfiguration({ mode: "standalone" }), {
  ...topologyForMode("standalone"),
  backendOrigin: "",
});
assert.equal(
  validateTopologyConfiguration({ mode: "office-host", backendOrigin: "https://host.example" }).backendOrigin,
  "https://host.example",
);
assert.equal(
  validateTopologyConfiguration({ mode: "office-client", backendOrigin: "https://nautex.office.example" }).backendOrigin,
  "https://nautex.office.example",
);
assert.throws(
  () => validateTopologyConfiguration({ mode: "office-client", backendOrigin: "http://192.168.1.20:3000" }),
  /HTTPS/,
);
assert.throws(() => validateTopologyConfiguration({ mode: "development" }), /not allowed/);
assert.equal(
  validateTopologyConfiguration({ mode: "development" }, { allowDevelopment: true }).backendOrigin,
  "http://127.0.0.1:3000",
);

console.log("Desktop runtime topology tests passed.");
