import jwt from "jsonwebtoken";
import { touchLastActive } from "../services/activity.service.js";
import User from "../models/user.model.js";
import { userIsAdmin } from "../services/analytics.logic.js";

function readBearerToken(req) {
  const header = req.header("Authorization") || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export default (req, res, next) => {
  const token = readBearerToken(req) || req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "No token, authorization denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    touchLastActive(decoded.id);
    next();
  } catch (err) {
    res.status(401).json({ message: "Token invalid" });
  }
};

/** Attach req.user when a JWT is valid; otherwise continue as a visitor. */
export function optionalAuth(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    touchLastActive(decoded.id);
  } catch (err) {
    req.user = null;
  }
  next();
}

/** 401 without a valid token, 403 if the user is not an admin. */
export async function requireAdmin(req, res, next) {
  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ message: "No token, authorization denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("isAdmin email");
    if (!user) return res.status(401).json({ message: "Token invalid" });
    if (!userIsAdmin(user)) {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.user = decoded;
    touchLastActive(decoded.id);
    next();
  } catch (err) {
    res.status(401).json({ message: "Token invalid" });
  }
}
