import { runJob, transferables } from './meshJobs.js';

self.onmessage = (e) => {
  const { id, name } = e.data;
  try {
    const result = runJob(name);
    self.postMessage({ id, result }, transferables(result));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
