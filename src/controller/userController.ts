import prisma from "../utils/prisma";
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "access_secret_key";
const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "refresh_secret_key";
const ACCESS_TOKEN_EXPIRY = "1d";
const REFRESH_TOKEN_EXPIRY = "7d";
// =====================
// Generate Tokens
// =====================
const generateAccessToken = (userId: string) => {
  return jwt.sign({ userId }, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
};

const generateRefreshToken = (userId: string) => {
  return jwt.sign({ userId }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
};

// =====================
// Create User
// =====================
export const createUser = async (req: Request, res: Response) => {
  const { name, password, email } = req.body;

  if (!name || !password) {
    return res.status(400).json({ error: "Name and password  are required" });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { name: name },
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const newUser = await prisma.user.create({
      data: {
        name: name,
        password: bcrypt.hashSync(password, 10),
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    return res.status(201).json(newUser);
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =====================
// Login User
// =====================
export const loginUser = async (req: Request, res: Response) => {
  const { name, password } = req.body;

  if (!name || !password) {
    return res.status(400).json({ error: "Name and password are required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { name: name },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token in secure http-only cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(200).json({
      message: "Login successful",
      accessToken,
      refreshToken, // Optional: send in response too
      user: {
        id: user.id,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =====================
// Refresh Access Token
// =====================
export const refreshAccessToken = async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: "Refresh token is required" });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as {
      userId: string;
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const newAccessToken = generateAccessToken(user.id);

    return res.status(200).json({
      message: "Access token refreshed",
      accessToken: newAccessToken,
    });
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "Refresh token expired. Please login again" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    console.error("Error refreshing token:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =====================
// Logout User
// =====================
export const logoutUser = async (req: Request, res: Response) => {
  res.clearCookie("refreshToken");
  return res.status(200).json({ message: "Logout successful" });
};

// =====================
// Get User Profile
// =====================
export const getProfile = async (
  req: Request & { userId?: string },
  res: Response
) => {
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =====================
// Update User Profile
// =====================
export const updateProfile = async (
  req: Request & { userId?: string },
  res: Response
) => {
  const userId = req.userId;
  const { name, password, currentPassword } = req.body;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Validate that at least one field is being updated
  if (!name && !password) {
    return res.status(400).json({
      error: "At least one field (name or password) must be provided",
    });
  }

  // If updating password, currentPassword is required
  if (password && !currentPassword) {
    return res.status(400).json({
      error: "currentPassword is required when updating password",
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify current password if updating password
    if (password) {
      const isCurrentPasswordValid = bcrypt.compareSync(
        currentPassword,
        user.password
      );
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }
    }

    // Check if name already exists (if name is being updated and different from current)
    if (name && name !== user.name) {
      const existingUser = await prisma.user.findUnique({
        where: { name: name },
      });
      if (existingUser) {
        return res.status(400).json({ error: "Name already exists" });
      }
    }

    // Prepare update data
    const updateData: { name?: string; password?: string } = {};
    if (name) {
      updateData.name = name;
    }
    if (password) {
      updateData.password = bcrypt.hashSync(password, 10);
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    return res.status(200).json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error: any) {
    console.error("Error updating profile:", error);

    // Handle Prisma unique constraint error
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Name already exists" });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
};
