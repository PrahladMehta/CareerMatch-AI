import { Router } from "express";
import {
  getConversationById,
  listConversations,
} from "../controller/conversationController";
import { verifyAccessToken } from "../middleware/jwtVerification";

const router = Router();

router.get("/conversations", verifyAccessToken, listConversations);
router.get(
  "/conversations/:conversationId",
  verifyAccessToken,
  getConversationById
);

export = router;
