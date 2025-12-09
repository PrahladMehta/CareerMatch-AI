import { Request, Response } from "express";
import prisma from "../utils/prisma";

type AuthedRequest = Request & { userId?: string };

/**
 * GET /api/v1/conversations
 * Returns conversation ids for the authenticated user with last message summary
 */
export async function listConversations(
  req: AuthedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        resumeId: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            text: true,
            role: true,
            source: true,
            createdAt: true,
          },
        },
      },
    });

    const payload = conversations.map((c) => ({
      id: c.id,
      title: c.title,
      resumeId: c.resumeId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastMessage: c.messages[0] || null,
    }));

    res.json({ conversations: payload });
  } catch (error: any) {
    console.error("listConversations error:", error.message);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
}

/**
 * GET /api/v1/conversations/:conversationId
 * Returns full conversation with messages in chronological order
 */
export async function getConversationById(
  req: AuthedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.userId;
    const { conversationId } = req.params;

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!conversationId) {
      res.status(400).json({ error: "conversationId is required" });
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: {
        id: true,
        title: true,
        resumeId: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            text: true,
            source: true,
            citedChunks: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        resumeId: conversation.resumeId,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        messages: conversation.messages,
      },
    });
  } catch (error: any) {
    console.error("getConversationById error:", error.message);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
}
