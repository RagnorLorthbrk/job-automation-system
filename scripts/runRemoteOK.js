import { fetchRemoteOK } from "./jobSources/remoteok.js";

async function run() {
  await fetchRemoteOK();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
