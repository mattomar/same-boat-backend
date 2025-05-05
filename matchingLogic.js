let waitingUser = null;

module.exports = function (io) {
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    if (waitingUser) {
      const room = `room-${waitingUser.id}-${socket.id}`;
      waitingUser.join(room);
      socket.join(room);

      waitingUser.emit("matched", { room });
      socket.emit("matched", { room });

      waitingUser = null;
    } else {
      waitingUser = socket;
      socket.emit("waiting");
    }

    socket.on("disconnect", () => {
      if (waitingUser === socket) {
        waitingUser = null;
      }
    });
  });
};
