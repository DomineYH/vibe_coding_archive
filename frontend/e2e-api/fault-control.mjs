import net from "node:net";

export function control(socketPath, message) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let input = "";
    socket.setTimeout(5000, () => socket.destroy(new Error("control timeout")));
    socket.on("error", reject);
    socket.on("connect", () => socket.write(JSON.stringify(message) + "\n"));
    socket.on("data", (data) => {
      input += data;
    });
    socket.on("end", () => {
      const result = JSON.parse(input);
      if (result.error) reject(new Error(result.error));
      else resolve(result);
    });
  });
}

export const proxyControl = (message) =>
  control(process.env.AUTH_PROXY_CONTROL, message);
export const serverControl = (message) =>
  control(process.env.AUTH_FAULT_CONTROL, message);

export const processControl = (message) =>
  control(process.env.AUTH_PROCESS_CONTROL, message);
