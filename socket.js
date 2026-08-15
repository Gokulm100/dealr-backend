import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { touchLastActive } from "./services/activity.service.js";

let ioInstance = null;

// Verify the handshake JWT and return the authoritative user id, or null if the
// token is missing/invalid.
const verifyHandshake = (handshakeAuth = {}) => {
  const { token } = handshakeAuth;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.id ? String(decoded.id) : null;
  } catch {
    return null;
  }
};

export const initSocket = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
  });

  // Require a valid JWT before a connection is established. This is the single
  // source of truth for a socket's identity.
  ioInstance.use((socket, next) => {
    const userId = verifyHandshake(socket.handshake?.auth);
    if (!userId) {
      return next(new Error("unauthorized"));
    }
    socket.data.userId = userId;
    touchLastActive(userId);
    next();
  });

  ioInstance.on("connection", (socket) => {
    // Identity is fixed by the auth middleware; join the user's private room.
    socket.join(`user:${socket.data.userId}`);

    // A client may only (re)join its own room — never an arbitrary user's room.
    socket.on("join", (userId) => {
      if (!socket.data.userId) return;
      if (userId && String(userId) !== socket.data.userId) return;
      socket.join(`user:${socket.data.userId}`);
    });

    socket.on("leave", (userId) => {
      if (!socket.data.userId) return;
      if (userId && String(userId) !== socket.data.userId) return;
      socket.leave(`user:${socket.data.userId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected (${socket.id}): ${reason}`);
    });
  });

  return ioInstance;
};

export const getSocket = () => ioInstance;
