const { createServer } = require("http");
const ioClient = require("socket.io-client");
const express = require("express");
const { Server } = require("socket.io");
const sessionMiddleware = require("../middlewares/sessionMiddleware");
const setupMatching = require("../matchingLogic");

let server, io, address;

beforeAll((done) => {
  const app = express();
  app.use(sessionMiddleware);
  const httpServer = createServer(app);
  io = new Server(httpServer);

  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  setupMatching(io);

  server = httpServer.listen(() => {
    address = `http://localhost:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  io.close();
  server.close(done);
});

function connectSocket() {
  return ioClient.connect(address, {
    transports: ["websocket"],
  });
}

test("matches two users correctly", (done) => {
  const socket1 = connectSocket();

  socket1.on("waiting", () => {
    const socket2 = connectSocket();

    socket2.on("matched", (data2) => {
      socket1.on("matched", (data1) => {
        try {
          expect(data1.room).toBeDefined();
          expect(data2.room).toBe(data1.room);
          socket1.disconnect();
          socket2.disconnect();
          done();
        } catch (err) {
          done(err);
        }
      });
    });
  });
});
