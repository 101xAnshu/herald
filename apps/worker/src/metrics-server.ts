import { createServer, type Server } from "node:http";

import { metricsContentType, metricsText } from "@herald/observability";

export const startMetricsServer = (port = 9100): Server => {
  const server = createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": metricsContentType() });
      res.end(await metricsText());
      return;
    }

    if (req.url === "/health/live") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port);
  return server;
};
