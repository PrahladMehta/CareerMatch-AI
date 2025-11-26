// src/utils/askQuestion.ts

import { queryRAG } from "./queryPincone.service.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// Fixed settings — you control everything
const TOP_K = 5;
const MIN_SCORE = 0.78;
const MODEL = "gpt-4o-mini";

const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY!,
  model: MODEL,
  temperature: 0.1,
});

// Use ChatPromptTemplate (required for ChatOpenAI)
const PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Answer the question using ONLY the context below.
If the context doesn't contain enough information, reply exactly: "I don't have enough information to answer this."`,
  ],
  ["human", `Context:\n{context}\n\nQuestion: {question}\n\nAnswer:`],
]);

// Build the chain
const chain = PROMPT.pipe(llm);

/**
 * Ask a question to your RAG system
 */
export async function askQuestion(
  question: string,
  documentId?: string
): Promise<string> {
  if (!question?.trim()) {
    return "Please provide a valid question.";
  }

  try {
    // 1. Retrieve relevant chunks from Pinecone
    const results = await queryRAG(question, {
      topK: TOP_K * 2,
      namespace: documentId || "",
    });

    // 2. Filter high-quality matches
    const goodChunks = results
      // .filter((r) => r.score >= MIN_SCORE)
      // .slice(0, TOP_K);
      console.log("GOOD CHUCKS : ",goodChunks);

    if (goodChunks.length === 0) {
      return "I don't have enough relevant information to answer your question.";
    }

    // 3. Build context string
    const context = goodChunks
      .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
      .join("\n\n");

    // 4. Run the chain and extract the text content safely
    const response = await chain.invoke({ question, context });

    // This is the ONLY safe way to get the string from ChatOpenAI
    let answer: string;

    if (typeof response.content === "string") {
      answer = response.content;
    } else if (Array.isArray(response.content)) {
      // Sometimes content is an array of blocks
      answer = response.content.map((block: any) => block.text || "").join("");
    } else {
      answer = String(response.content || "");
    }

    return answer.trim();

  } catch (error: any) {
    console.error("RAG ask failed:", error);
    return "Sorry, something went wrong. Please try again later.";
  }
}