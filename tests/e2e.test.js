process.env.JWT_SECRET = "test-secret";

const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { io: ioc } = require("socket.io-client");

const db = require("../models");
const { setupDirectMessages } = require("../socket/dmSocket");
const messageRoutes = require("../routes/messageRoute");

let passed = 0;
let failed = 0;

const check = (name, condition, extra = "") => {
  if (condition) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`, extra);
  }
};

const testRun = `${Date.now()}-${process.pid}`;
const sockets = [];

(async () => {
  await db.sequelize.sync();

  // Create isolated users for this test run.
  const makeUser = (name) =>
    db.User.create({
      firstName: name,
      lastName: "Test",
      email: `${name.toLowerCase()}-${testRun}@example.test`,
      password: "test-password",
      username: `${name.toLowerCase()}-${testRun}`,
    });

  const [A, B, C, D] = await Promise.all(
    ["Ann", "Bob", "Cy", "Di"].map(makeUser),
  );

  // Ann and Di are friends.
  await db.FriendRequest.create({
    senderId: A.id,
    receiverId: D.id,
    status: "accepted",
  });

  // Cy and Bob only have a pending friend request.
  await db.FriendRequest.create({
    senderId: C.id,
    receiverId: B.id,
    status: "pending",
  });

  const app = express();
  app.use(express.json());
  app.use("/api/messages", messageRoutes);

  const server = http.createServer(app);
  const io = new Server(server);

  let defaultNamespaceConnections = 0;
  io.on("connection", () => {
    defaultNamespaceConnections++;
  });

  // Calling setup twice should not register duplicate handlers.
  setupDirectMessages(io);
  setupDirectMessages(io);

  await new Promise((resolve) => server.listen(0, resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tokenFor = (user) =>
    jwt.sign({ userId: user.id }, process.env.JWT_SECRET);

  // Paths passed to api() are relative to /api/messages.
  const api = async (user, method, path, body) => {
    const response = await fetch(`${baseUrl}/api/messages${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    let json = null;

    try {
      json = await response.json();
    } catch {
      // Some endpoints may return non-JSON responses.
    }

    return {
      status: response.status,
      body: json,
    };
  };

  const connectSocket = (user, token = tokenFor(user)) =>
    new Promise((resolve, reject) => {
      const socket = ioc(`${baseUrl}/dm`, {
        auth: { token },
        reconnection: false,
        timeout: 3000,
      });

      sockets.push(socket);

      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", (error) => reject(error));
    });

  const emitAck = (socket, event, payload) =>
    new Promise((resolve) => {
      socket.timeout(3000).emit(event, payload, (error, response) => {
        if (error) {
          resolve({ ok: false, error: error.message });
        } else {
          resolve(response);
        }
      });
    });

  const waitForEvent = (socket, event, timeoutMs = 2000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, listener);
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);

      const listener = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };

      socket.once(event, listener);
    });

  let result;
  let conversationId;
  let requestId;

  console.log("\n=== Authentication and validation ===");

  result = await api(null, "GET", "/conversations");
  check("Missing token returns 401", result.status === 401);

  result = await api(A, "POST", `/conversations/with/${A.id}`);
  check("Cannot start conversation with yourself", result.status === 400);

  result = await api(A, "POST", `/requests/send/${A.id}`, {
    text: "Hello",
  });
  check("Cannot send request to yourself", result.status === 400);

  result = await api(A, "POST", "/conversations/with/999999999");
  check("Unknown user returns 404", result.status === 404);

  result = await api(A, "POST", "/conversations/with/not-an-id");
  check("Invalid user ID returns 400", result.status === 400);

  console.log("\n=== Message-request restrictions ===");

  result = await api(A, "POST", `/conversations/with/${B.id}`);
  check(
    "Non-friends cannot bypass message requests",
    result.status === 403 && result.body?.code === "REQUEST_REQUIRED",
  );

  result = await api(C, "POST", `/conversations/with/${B.id}`);
  check(
    "Pending friend request does not count as friendship",
    result.status === 403,
  );

  result = await api(A, "POST", `/requests/send/${B.id}`, {
    text: "   ",
  });
  check("Empty request message is rejected", result.status === 400);

  result = await api(A, "POST", `/requests/send/${B.id}`, {
    text: "x".repeat(2001),
  });
  check("Overlong request message is rejected", result.status === 400);

  console.log("\n=== Friends can message immediately ===");

  result = await api(A, "POST", `/conversations/with/${D.id}`);

  check(
    "Friends can create a conversation",
    result.status === 200 && !!result.body?.conversationId,
  );

  const friendConversationId = result.body?.conversationId;

  result = await api(D, "POST", `/conversations/with/${A.id}`);

  check(
    "Opening the same conversation does not create a duplicate",
    result.body?.conversationId === friendConversationId,
  );

  result = await api(A, "POST", `/requests/send/${D.id}`, {
    text: "Hello",
  });

  check(
    "Friends do not need a message request",
    result.status === 409 && result.body?.code === "DIRECT_MESSAGE_ALLOWED",
  );

  console.log("\n=== Sending and receiving requests ===");

  const socketB = await connectSocket(B);

  const newRequestEvent = waitForEvent(socketB, "dm:request:new");

  result = await api(A, "POST", `/requests/send/${B.id}`, {
    text: "Hey Bob, saw your post",
  });

  check(
    "Sending a message request returns 201",
    result.status === 201 && result.body?.status === "pending",
  );

  requestId = result.body?.id;

  const newRequestPayload = await newRequestEvent.catch(() => null);

  check(
    "Recipient receives the new-request socket event",
    !!newRequestPayload && String(newRequestPayload.id) === String(requestId),
  );

  result = await api(A, "POST", `/requests/send/${B.id}`, {
    text: "Another request",
  });

  check("Duplicate pending request is rejected", result.status === 409);

  result = await api(B, "POST", `/requests/send/${A.id}`, {
    text: "Reply request",
  });

  check(
    "Reverse request is rejected while one is pending",
    result.status === 409 &&
      result.body?.code === "REQUEST_INCOMING" &&
      String(result.body?.requestId) === String(requestId),
  );

  result = await api(B, "GET", `/status/${A.id}`);

  check(
    "Recipient relationship is pending_received",
    result.body?.status === "pending_received" &&
      result.body?.initialMessage?.startsWith("Hey Bob"),
  );

  result = await api(A, "GET", `/status/${B.id}`);

  check(
    "Sender relationship is pending_sent",
    result.body?.status === "pending_sent",
  );

  result = await api(B, "GET", "/requests/incoming");

  check(
    "Incoming requests include sender information",
    Array.isArray(result.body) &&
      result.body.some(
        (request) =>
          String(request.id) === String(requestId) &&
          request.sender?.firstName === "Ann",
      ),
  );

  result = await api(A, "GET", "/requests/outgoing");

  check(
    "Outgoing requests include recipient information",
    Array.isArray(result.body) &&
      result.body.some(
        (request) =>
          String(request.id) === String(requestId) &&
          request.status === "pending" &&
          request.receiver?.firstName === "Bob",
      ),
  );

  result = await api(A, "GET", "/conversations");

  check(
    "Pending request does not grant conversation access",
    Array.isArray(result.body) &&
      result.body.every(
        (conversation) => String(conversation.otherUser?.id) !== String(B.id),
      ),
  );

  result = await api(A, "POST", `/requests/accept/${requestId}`);

  check("Sender cannot accept their own request", result.status === 403);

  result = await api(C, "POST", `/requests/accept/${requestId}`);

  check("Third party cannot accept the request", result.status === 403);

  result = await api(B, "POST", "/requests/accept/999999999");

  check("Unknown request cannot be accepted", result.status === 404);

  console.log("\n=== Accepting a request ===");

  const socketA = await connectSocket(A);

  const acceptedEventA = waitForEvent(socketA, "dm:request:accepted");

  const acceptedEventB = waitForEvent(socketB, "dm:request:accepted");

  result = await api(B, "POST", `/requests/accept/${requestId}`);

  check(
    "Recipient can accept the request",
    result.status === 200 && !!result.body?.conversationId,
  );

  conversationId = result.body?.conversationId;

  const [acceptedA, acceptedB] = await Promise.all([
    acceptedEventA.catch(() => null),
    acceptedEventB.catch(() => null),
  ]);

  check(
    "Both users receive acceptance notification",
    !!acceptedA &&
      !!acceptedB &&
      String(acceptedA.conversationId) === String(conversationId) &&
      String(acceptedB.conversationId) === String(conversationId),
  );

  result = await api(B, "POST", `/requests/accept/${requestId}`);

  check("Accepting the same request twice is rejected", result.status === 409);

  result = await api(A, "GET", `/conversations/${conversationId}/messages`);

  check(
    "Initial request message appears in conversation history",
    Array.isArray(result.body?.messages) &&
      result.body.messages.length === 1 &&
      String(result.body.messages[0].senderId) === String(A.id) &&
      result.body.messages[0].text?.startsWith("Hey Bob"),
  );

  check(
    "Conversation history includes the other user's name",
    result.body?.conversation?.otherUser?.firstName === "Bob",
  );

  result = await api(A, "GET", "/requests/outgoing");

  check(
    "Outgoing request changes to accepted",
    Array.isArray(result.body) &&
      result.body.some(
        (request) =>
          String(request.id) === String(requestId) &&
          request.status === "accepted" &&
          String(request.conversationId) === String(conversationId),
      ),
  );

  console.log("\n=== Socket room authorization ===");

  await emitAck(socketA, "dm:join", {
    conversationId,
  });

  const joinB = await emitAck(socketB, "dm:join", {
    conversationId,
  });

  check("Conversation participant can join room", joinB?.ok === true);

  const socketC = await connectSocket(C);

  const joinC = await emitAck(socketC, "dm:join", {
    conversationId,
  });

  check("Non-participant cannot join room", joinC?.ok === false);

  const sendC = await emitAck(socketC, "dm:send", {
    conversationId,
    text: "Unauthorized message",
  });

  check("Non-participant cannot send through socket", sendC?.ok === false);

  result = await api(C, "GET", `/conversations/${conversationId}/messages`);

  check("Non-participant cannot read history", result.status === 404);

  result = await api(C, "POST", `/conversations/${conversationId}/messages`, {
    text: "Unauthorized REST message",
  });

  check("Non-participant cannot send through REST", result.status === 404);

  let leakedMessage = false;

  socketC.on("dm:message", () => {
    leakedMessage = true;
  });

  console.log("\n=== Sending messages ===");

  const liveMessageEvent = waitForEvent(socketB, "dm:message");

  const socketSend = await emitAck(socketA, "dm:send", {
    conversationId,
    text: "  socket hello  ",
  });

  const liveMessage = await liveMessageEvent.catch(() => null);

  check(
    "Socket message is saved and acknowledged",
    socketSend?.ok === true && socketSend.message?.text === "socket hello",
  );

  check(
    "Recipient receives the message live",
    !!liveMessage && String(liveMessage.id) === String(socketSend?.message?.id),
  );

  check(
    "Message exists in the database",
    !!socketSend?.message?.id &&
      !!(await db.Message.findByPk(socketSend.message.id)),
  );

  const liveRestEvent = waitForEvent(socketA, "dm:message");

  result = await api(B, "POST", `/conversations/${conversationId}/messages`, {
    text: "rest reply",
  });

  check(
    "REST message returns 201 and uses authenticated sender",
    result.status === 201 && String(result.body?.senderId) === String(B.id),
  );

  const restBroadcast = await liveRestEvent.catch(() => null);

  check("REST message is broadcast to conversation", !!restBroadcast);

  result = await api(B, "POST", `/conversations/${conversationId}/messages`, {
    text: "",
  });

  check("Empty message is rejected", result.status === 400);

  result = await api(B, "POST", `/conversations/${conversationId}/messages`, {
    text: "spoof attempt",
    senderId: A.id,
  });

  check(
    "Client cannot spoof senderId",
    result.status === 201 && String(result.body?.senderId) === String(B.id),
  );

  await new Promise((resolve) => setTimeout(resolve, 200));

  check("Unauthorized socket receives no messages", !leakedMessage);

  console.log("\n=== Pagination ===");

  for (let index = 0; index < 5; index++) {
    await api(A, "POST", `/conversations/${conversationId}/messages`, {
      text: `bulk ${index}`,
    });
  }

  result = await api(
    A,
    "GET",
    `/conversations/${conversationId}/messages?limit=3`,
  );

  const page = result.body;
  const firstPage = page?.messages ?? [];
  const cursor = firstPage[0]?.id;

  check(
    "Limit is respected and page is ordered",
    firstPage.length === 3 &&
      page.hasMore === true &&
      firstPage[0].id < firstPage[1].id &&
      firstPage[1].id < firstPage[2].id,
  );

  result = await api(
    A,
    "GET",
    `/conversations/${conversationId}/messages?limit=100&before=${cursor}`,
  );

  check(
    "Before cursor returns only older messages",
    Array.isArray(result.body?.messages) &&
      result.body.messages.every((message) => message.id < cursor),
  );

  result = await api(
    A,
    "GET",
    `/conversations/${conversationId}/messages?before=not-a-number`,
  );

  check("Invalid pagination cursor is rejected", result.status === 400);

  console.log("\n=== Conversation list ===");

  result = await api(A, "GET", "/conversations");

  check(
    "Conversation list includes both conversations",
    Array.isArray(result.body) &&
      result.body.length === 2 &&
      result.body.every((conversation) => conversation.otherUser?.username),
  );

  check(
    "Conversation list does not expose password or email",
    !/password|email/i.test(JSON.stringify(result.body)),
  );

  check(
    "Most recently active conversation appears first",
    result.body?.[0]?.id === conversationId,
  );

  console.log("\n=== Decline and cooldown ===");

  result = await api(C, "POST", `/requests/send/${D.id}`, {
    text: "Hello Di",
  });

  check(
    "Cy can send a request to Di",
    result.status === 201 && !!result.body?.id,
  );

  const declineRequestId = result.body?.id;

  result = await api(C, "POST", `/requests/decline/${declineRequestId}`);

  check("Sender cannot decline their own request", result.status === 403);

  const socketCForDecline = await connectSocket(C);
  const declinedEvent = waitForEvent(socketCForDecline, "dm:request:declined");

  result = await api(D, "POST", `/requests/decline/${declineRequestId}`);

  check(
    "Recipient can decline the request",
    result.status === 200 && result.body?.request?.status === "declined",
  );

  const declinePayload = await declinedEvent.catch(() => null);

  check("Sender receives decline notification", !!declinePayload);

  result = await api(C, "GET", "/requests/outgoing");

  check(
    "Sender can see declined request",
    Array.isArray(result.body) &&
      result.body.some(
        (request) =>
          String(request.id) === String(declineRequestId) &&
          request.status === "declined",
      ),
  );

  result = await api(C, "POST", `/requests/send/${D.id}`, {
    text: "Please accept",
  });

  check(
    "Request during cooldown is rejected",
    result.status === 403 && result.body?.code === "REQUEST_COOLDOWN",
  );

  result = await api(C, "POST", `/conversations/with/${D.id}`);

  check(
    "Declined request does not grant conversation access",
    result.status === 403,
  );

  await db.MessageRequest.update(
    { respondedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    { where: { id: declineRequestId } },
  );

  result = await api(C, "POST", `/requests/send/${D.id}`, {
    text: "Trying again after cooldown",
  });

  check("Request can be sent after cooldown", result.status === 201);

  console.log("\n=== Database duplicate-request protection ===");

  let duplicateBlocked = false;

  try {
    await db.MessageRequest.create({
      senderId: D.id,
      receiverId: C.id,
      initialMessage: "Race condition test",
      pairKey: `${Math.min(C.id, D.id)}:${Math.max(C.id, D.id)}`,
      status: "pending",
    });
  } catch (error) {
    duplicateBlocked = error.name === "SequelizeUniqueConstraintError";
  }

  check("Database prevents duplicate pending requests", duplicateBlocked);

  console.log("\n=== Socket authentication and namespace isolation ===");

  check(
    "Socket connection without token is rejected",
    await connectSocket(A, "").then(
      () => false,
      () => true,
    ),
  );

  check(
    "Socket connection with invalid token is rejected",
    await connectSocket(A, "invalid-token").then(
      () => false,
      () => true,
    ),
  );

  check(
    "DM sockets do not connect to the default namespace",
    defaultNamespaceConnections === 0,
  );

  console.log(`\n${passed} passed, ${failed} failed`);

  for (const socket of sockets) {
    socket.disconnect();
  }

  await new Promise((resolve) => io.close(resolve));
  await new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(resolve);
  });

  process.exitCode = failed === 0 ? 0 : 1;
})().catch(async (error) => {
  console.error("\nTest suite crashed:", error);

  for (const socket of sockets) {
    socket.disconnect();
  }

  process.exitCode = 2;
});
