import { createServer } from "node:http";

const [name, portText] = process.argv.slice(2);
if (name === "worker") {
  setInterval(() => {}, 1000);
} else {
  const port = Number(portText);
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(name + " healthy");
  });
  server.listen(port, "127.0.0.1");
}
