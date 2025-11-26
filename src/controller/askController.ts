// src/controllers/askController.ts

import { Request, Response } from "express";
import { askQuestion } from "../services/askQuestion.service";

/**
 * POST /api/ask
 * Body: { "question": "Your question here", "documentId": "optional-doc-id" }
 */
export async function askController(req: Request, res: Response): Promise<void> {
  try {
    const { question, documentId } = req.body;

    // Validation
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      res.status(400).json({
        error: "A valid 'question' string is required.",
      });
      return;
    }

    if (documentId && typeof documentId !== "string") {
      res.status(400).json({
        error: "'documentId' must be a string if provided.",
      });
      return;
    }

    const cleanQuestion = question.trim();

    console.log(`[ASK] Question: "${cleanQuestion}"${documentId ? ` | Doc: ${documentId}` : ""}`);

    // Call your RAG pipeline (all settings are fixed & safe inside askQuestion)
    const answer = await askQuestion(cleanQuestion, documentId?.trim() || undefined);

    // Success response
    res.json({
      question: cleanQuestion,
      answer,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("askController error:", error);

    res.status(500).json({
      error: "Failed to process your question. Please try again later.",
      // Remove in production if you don't want to leak details
      // details: error.message,
    });
  }
}