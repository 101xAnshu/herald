export { startWorker } from "./runtime";

import { startWorker } from "./runtime";

if (require.main === module) {
  void startWorker();
}
