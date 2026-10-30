export { createApp } from "./app";
export { startServer } from "./server";

import { startServer } from "./server";

if (require.main === module) {
  void startServer();
}
