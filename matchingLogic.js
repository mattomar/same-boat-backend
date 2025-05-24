let waitingUser = null;

module.exports = function (io) {
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    if (waitingUser && waitingUser.connected) {
      const room = `room-${waitingUser.id}-${socket.id}`;
      waitingUser.join(room);
      socket.join(room);

      waitingUser.emit("matched", { room });
      socket.emit("matched", { room });

      const addChatListeners = (clientSocket) => {
        // Broadcast chat messages to the room
        clientSocket.on("chat message", ({ room, message }) => {
          io.to(room).emit("chat message", {
            message,
            sender: clientSocket.id,
          });
        });

        // Broadcast typing status
        clientSocket.on("typing", ({ room }) => {
          clientSocket.to(room).emit("partner-typing", { sender: clientSocket.id });
        });



        // Handle end of session
        clientSocket.on("end session", ({ room }) => {
          clientSocket.leave(room);
          clientSocket.to(room).emit("session ended");
        });

        // Handle disconnection
        clientSocket.on("disconnect", () => {
          console.log(`User disconnected: ${clientSocket.id}`);
          clientSocket.to(room).emit("session ended");
        });
      };

      addChatListeners(waitingUser);
      addChatListeners(socket);

      waitingUser = null;
    } else {
      waitingUser = socket;
      socket.emit("waiting");

      socket.on("disconnect", () => {
        console.log(`Waiting user disconnected: ${socket.id}`);
        if (waitingUser === socket) {
          waitingUser = null;
        }
      });
    }
  });
};