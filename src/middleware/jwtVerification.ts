import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET!
export const verifyAccessToken = (
  req: Request & { userId?: string },
  res: Response,
  next: Function
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: "Access token is required" });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as {
      userId: string;
    };

    console.log("Decoded JWT:", decoded);
    req.userId = decoded.userId;
    
    if (!req.userId) {
      return res.status(401).json({ error: "Invalid access token" });
    }
    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Access token expired. Please refresh" });
    }
    return res.status(401).json({ error: "Invalid access token" });
  }
};