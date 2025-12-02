// src/utils/askQuestion.ts

import { queryRAG } from "./queryPincone.service.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import axios from "axios";
import prisma from "../utils/prisma.js";

// Fixed settings
const TOP_K = 10;
const MIN_SCORE = 0.5;
const MODEL = "gpt-4o-mini";

const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY!,
  model: MODEL,
  temperature: 0.1,
});

// Prompt for RAG context
const RAG_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer the question using ONLY the provided context.
Rules:
1. Use ONLY information from the context provided
2. If the context contains relevant information, answer the question
3. Only say "I don't have enough information" if the context truly doesn't address the question at all
4. Be concise and direct`,
  ],
  [
    "human",
    `Context:
{context}

Question: {question}

Answer:`,
  ],
]);

// Prompt for web search results
const WEB_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer the question using the provided web search results.
Rules:
1. Use the search results to answer the question
2. Provide accurate, helpful information
3. If results don't contain the answer, say so
4. Be concise and direct`,
  ],
  [
    "human",
    `Search Results:
{context}

Question: {question}

Answer:`,
  ],
]);

const ragChain = RAG_PROMPT.pipe(llm);
const webChain = WEB_PROMPT.pipe(llm);

/**
 * Search using Serper API
 */
async function searchWithSerper(query: string): Promise<string> {
  try {
    if (!process.env.SERPER_API_KEY) {
      console.log("⚠ SERPER_API_KEY not set, skipping web search");
      return "";
    }

    console.log("🌐 Searching the web with Serper...");

    const response = await axios.post("https://google.serper.dev/search", {
      q: query,
      num: 5,
    }, {
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json",
      },
    });

    if (!response.data.organic || response.data.organic.length === 0) {
      console.log("⚠ No web search results found");
      return "";
    }

    // Format search results
    const formattedResults = response.data.organic
      .slice(0, 5)
      .map((result: any, i: number) => 
        `[${i + 1}] ${result.title}\n${result.snippet}`
      )
      .join("\n\n");

    console.log(`✓ Got ${response.data.organic.length} search results`);
    return formattedResults;
  } catch (error: any) {
    console.error("❌ Serper search failed:", error.message);
    return "";
  }
}

/**
 * Check if context is relevant (simple heuristic)
 */
function isContextRelevant(chunks: any[]): boolean {
  if (chunks.length === 0) return false;
  
  // If we have at least 2 chunks with decent scores, consider it relevant
  const relevantChunks = chunks.filter((c) => c.score >= MIN_SCORE);
  return relevantChunks.length >= 2;
}

/**
 * Ask a question to your RAG system with Serper fallback
 */
export async function askQuestion(
  question: string,
  documentId?: string,
  conversationId?:string
): Promise<string> {
  if (!question?.trim()) {
    return "Please provide a valid question.";
  }

  try {
    console.log("\n🔍 Question:", question);

    // 1. Try RAG first
    console.log("📡 Querying RAG system...");
    const results = await queryRAG(question, {
      topK: TOP_K * 2,
      namespace: documentId || "",
    });

    console.log(`✓ Retrieved ${results.length} results from RAG`);

    // 2. Check if RAG results are relevant
    const ragRelevant = isContextRelevant(results);
    console.log(
      `📊 RAG Relevance: ${ragRelevant ? "✓ Good" : "✗ Poor"}`
    );

    if (ragRelevant) {
      // Use RAG context
      console.log("✓ Using RAG context");

      const goodChunks = results
        .filter((r) => r.score >= MIN_SCORE)
        .slice(0, TOP_K);

      const context = goodChunks
        .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
        .join("\n\n");

      console.log(`📝 RAG context length: ${context.length} chars\n`);

      const response = await ragChain.invoke({ question, context });
      const answer = extractAnswer(response);

      if (
        answer &&
        !answer.includes("don't have enough information") &&
        answer.length > 10
      ) {
        console.log(`✓ RAG answer: ${answer.substring(0, 100)}...\n`);
        return answer;
      }
    }

    // 3. RAG didn't work well, try Serper
    console.log("⚠ RAG context not sufficient, falling back to Serper API...\n");

    const webContext = await searchWithSerper(question);

    if (!webContext) {
      return "I don't have enough information to answer this question. Please try a different question or provide more context.";
    }

    // Use web search results
    console.log("🤖 Generating answer from web search...");
    const response = await webChain.invoke({
      question,
      context: webContext,
    });

    const answer = extractAnswer(response);
    console.log(`✓ Web answer: ${answer.substring(0, 100)}...\n`);
    


    return answer;
  } catch (error: any) {
    console.error("❌ Question answering failed:", error.message);
    return "Sorry, something went wrong. Please try again later.";
  }
}

/**
 * Helper function to safely extract text from ChatOpenAI response
 */
function extractAnswer(response: any): string {
  let answer: string;

  if (typeof response.content === "string") {
    answer = response.content;
  } else if (Array.isArray(response.content)) {
    answer = response.content.map((block: any) => block.text || "").join("");
  } else {
    answer = String(response.content || "");
  }

  return answer.trim();
}