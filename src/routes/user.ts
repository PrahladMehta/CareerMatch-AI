import express from "express";
import {
  createUser,
  loginUser,
  refreshAccessToken,
  getProfile,
  updateProfile,
} from "../controller/userController";
import { verifyAccessToken } from "../middleware/jwtVerification";

const router = express.Router();

router.post("/create", createUser);
router.post("/login", loginUser);
router.post("/refresh-token", refreshAccessToken);

// Profile routes (require authentication)
router.get("/profile", verifyAccessToken, getProfile);
router.put("/profile", verifyAccessToken, updateProfile);

export default router;
