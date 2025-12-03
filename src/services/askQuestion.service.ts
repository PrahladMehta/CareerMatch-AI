// src/utils/askQuestion.ts

import { queryRAG } from "./queryPincone.service.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import axios from "axios";
import prisma from "../utils/prisma.js";

const TOP_K = 10;
const MIN_SCORE = 0.1;
const MODEL = "gpt-4o-mini";

const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY!,
  model: MODEL,
  temperature: 0.1,
});

const COMBINED_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer the question using BOTH your resume context and web search results.
Rules:
1. If resume context is available and relevant, use it as primary source
2. Use web search results as supplementary information
3. Clearly indicate the source (e.g., "Based on your resume..." or "From web search...")
4. If BOTH sources lack relevant information, say: "I don't have enough information to answer this."
5. Be concise and accurate
6. If information conflicts between sources, note both perspectives`,
  ],
  [
    "human",
    `Resume Context:
{ragContext}

Web Search Results:
{webContext}

Question: {question}

Answer:`,
  ],
]);

const RAG_ONLY_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer using ONLY the resume context provided.
Rules:
1. Use ONLY information from the context
2. Be concise and direct
3. Only say "I don't have enough information" if context doesn't address the question`,
  ],
  [
    "human",
    `Resume Context:
{context}

Question: {question}

Answer:`,
  ],
]);

const WEB_ONLY_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a job-search assistant. Extract job openings from search results.
Rules:
1. Only return jobs where the user can apply
2. Include job title, company name, and application link
3. If no jobs found, say: "No job openings found."
4. Do NOT include irrelevant information (articles, blogs, courses)
5. List only real job opportunities`,
  ],
  [
    "human",
    `Search Results:
{context}

User Query: {question}

Provide a clean list of job openings with apply links only.

Answer:`,
  ],
]);

const combinedChain = COMBINED_PROMPT.pipe(llm);
const ragOnlyChain = RAG_ONLY_PROMPT.pipe(llm);
const webOnlyChain = WEB_ONLY_PROMPT.pipe(llm);

interface CitedChunk {
  id: string;
  score: number;
  content: string;
  documentId: string;
  chunkIndex: number;
  source: "rag" | "web";
}

interface QuestionResponse {
  conversationId: string;
  answer: string;
  citedChunks: CitedChunk[];
  source: "rag" | "web" | "combined" | "error";
}

/**
 * Search using Serper API
 */
async function searchWithSerper(query: string): Promise<CitedChunk[]> {
  try {
    if (!process.env.SERPER_API_KEY) {
      return [];
    }

    const response = await axios.post("https://google.serper.dev/search", {
      q: query,
      num: 10,
    }, {
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
    });

    if (!response.data.organic || response.data.organic.length === 0) {
      return [];
    }

    const webChunks: CitedChunk[] = response.data.organic
      .slice(0, 10)
      .map((result: any, i: number) => ({
        id: `web_result_${i}`,
        score: 1 - i * 0.05,
        content: `${result.title}\n${result.snippet}`,
        documentId: "web",
        chunkIndex: i,
        source: "web" as const,
      }));

    return webChunks;
  } catch (error: any) {
    console.error("Serper API error:", error.message);
    return [];
  }
}

/**
 * Check if context is relevant
 */
function isContextRelevant(chunks: any[]): boolean {
  if (chunks.length === 0) return false;
  const relevantChunks = chunks.filter((c) => c.score >= MIN_SCORE);
  return relevantChunks.length >= 2;
}

/**
 * Create or get conversation
 */
async function getOrCreateConversation(
  userId: string,
  conversationId?: string,
  resumeId?: string
): Promise<string> {
  if (conversationId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (conversation) return conversationId;
  }

  const newConversation = await prisma.conversation.create({
    data: {
      userId,
      resumeId: resumeId || null,
      title: `Chat - ${new Date().toLocaleString()}`,
    },
  });

  return newConversation.id;
}

/**
 * Save message to database
 */
async function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  text: string,
  source: string,
  citedChunks: CitedChunk[]
): Promise<string> {
  try {
    const citedChunksData = citedChunks.length > 0 
      ? citedChunks.map((chunk) => ({
          id: chunk.id,
          score: chunk.score,
          content: chunk.content,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          source: chunk.source,
        }))
      : null;

    const message = await prisma.message.create({
      data: {
        conversationId,
        role,
        text,
        source,
        citedChunks: citedChunksData as any,
      },
    });

    return message.id;
  } catch (error: any) {
    console.error("Failed to save message:", error.message);
    throw error;
  }
}

/**
 * Ask a question using combined RAG + Web search
 */
export async function askQuestion(
  question: string,
  userId: string,
  conversationId?: string,
  resumeId?: string
): Promise<QuestionResponse> {
  if (!question?.trim()) {
    return {
      conversationId: "",
      answer: "Please provide a valid question.",
      citedChunks: [],
      source: "error",
    };
  }

  try {
    // Get or create conversation
    const finalConversationId = await getOrCreateConversation(
      userId,
      conversationId,
      resumeId
    );

    // Save user message
    await saveMessage(
      finalConversationId,
      "user",
      question,
      "user",
      []
    );

    // Query both RAG and Web simultaneously
    const [ragResults, webChunks] = await Promise.all([
      queryRAG(question, {
        topK: TOP_K * 2,
        filter: {
          userId,
          resumeId,
        },
      }),
      searchWithSerper(question),
    ]);

    console.log(`RAG results: ${ragResults.length}, Web results: ${webChunks.length}`);

    const ragRelevant = isContextRelevant(ragResults);
    const webRelevant = webChunks.length > 0;

    console.log(`RAG relevant: ${ragRelevant}, Web relevant: ${webRelevant}`);

    // Case 1: Both RAG and Web have relevant context - combine them
    if (ragRelevant && webRelevant) {
      const goodRagChunks = ragResults
        .filter((r) => r.score >= MIN_SCORE)
        .slice(0, TOP_K);

      const ragContext = goodRagChunks
        .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
        .join("\n\n");

      const webContext = webChunks
        .map((c, i) => `[${i + 1}] ${c.content}`)
        .join("\n\n");

      const response = await combinedChain.invoke({
        question,
        ragContext,
        webContext,
      });

      const answer = extractAnswer(response);

      if (answer && answer.length > 10) {
        const citedChunks: CitedChunk[] = [
          ...goodRagChunks.map((chunk) => ({
            id: chunk.id,
            score: chunk.score,
            content: chunk.content,
            documentId: chunk.documentId,
            chunkIndex: chunk.chunkIndex,
            source: "rag" as const,
          })),
          ...webChunks.slice(0, 3).map((chunk) => ({
            ...chunk,
            source: "web" as const,
          })),
        ];

        await saveMessage(
          finalConversationId,
          "assistant",
          answer,
          "combined",
          citedChunks
        );

        return {
          conversationId: finalConversationId,
          answer,
          citedChunks,
          source: "combined",
        };
      }
    }

    // Case 2: Only RAG has relevant context
    if (ragRelevant && !webRelevant) {
      const goodRagChunks = ragResults
        .filter((r) => r.score >= MIN_SCORE)
        .slice(0, TOP_K);

      const context = goodRagChunks
        .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
        .join("\n\n");

      const response = await ragOnlyChain.invoke({ question, context });
      const answer = extractAnswer(response);

      if (answer && answer.length > 10 && !answer.includes("don't have enough")) {
        const citedChunks: CitedChunk[] = goodRagChunks.map((chunk) => ({
          id: chunk.id,
          score: chunk.score,
          content: chunk.content,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          source: "rag" as const,
        }));

        await saveMessage(
          finalConversationId,
          "assistant",
          answer,
          "resume",
          citedChunks
        );

        return {
          conversationId: finalConversationId,
          answer,
          citedChunks,
          source: "rag",
        };
      }
    }

    // Case 3: Only Web has relevant context
    if (!ragRelevant && webRelevant) {
      const webContext = webChunks
        .map((c, i) => `[${i + 1}] ${c.content}`)
        .join("\n\n");

      const response = await webOnlyChain.invoke({
        question,
        context: webContext,
      });

      const answer = extractAnswer(response);

      if (answer && answer.length > 10 && !answer.includes("No job openings")) {
        await saveMessage(
          finalConversationId,
          "assistant",
          answer,
          "web",
          webChunks
        );

        return {
          conversationId: finalConversationId,
          answer,
          citedChunks: webChunks,
          source: "web",
        };
      }
    }

    // Case 4: Neither has relevant context
    const errorAnswer =
      "I don't have enough information to answer this question. Please try a different question or provide more context.";

    await saveMessage(
      finalConversationId,
      "assistant",
      errorAnswer,
      "error",
      []
    );

    return {
      conversationId: finalConversationId,
      answer: errorAnswer,
      citedChunks: [],
      source: "error",
    };
  } catch (error: any) {
    console.error("Question answering error:", error.message);
    return {
      conversationId: "",
      answer: "Sorry, something went wrong. Please try again later.",
      citedChunks: [],
      source: "error",
    };
  }
}

/**
 * Extract text from LLM response
 */
function extractAnswer(response: any): string {
  if (typeof response.content === "string") {
    return response.content;
  }
  if (Array.isArray(response.content)) {
    return response.content.map((block: any) => block.text || "").join("");
  }
  return String(response.content || "");
}