// src/utils/askQuestion.ts

import { queryRAG } from "./queryPincone.service.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// Fixed settings — you control everything
const TOP_K = 10;
const MIN_SCORE = 0.5; // Lowered from 0.78 to capture more results
const MODEL = "gpt-4o-mini";

const llm = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY!,
  model: MODEL,
  temperature: 0.1,
});

// Updated prompt - clearer instruction to use context
const PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are a helpful assistant. Your job is to answer questions based on the provided context.
    
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
    console.log("\n🔍 Question:", question);

    // 1. Retrieve relevant chunks from Pinecone
    console.log("📡 Querying Pinecone...");
    const results = await queryRAG(question, {
      topK: TOP_K * 2, // Get 20 results
      namespace: documentId || "",
    });

    console.log(`✓ Retrieved ${results.length} results from Pinecone`);

    // 2. Log ALL results with scores for debugging
    if (results.length > 0) {
      console.log("\n📊 All retrieval scores:");
      results.slice(0, 5).forEach((r, i) => {
        console.log(
          `  [${i + 1}] Score: ${r.score?.toFixed(3)} | Content: ${r.content?.substring(0, 60)}...`
        );
      });
    }

    // 3. Filter and select chunks - ACTUALLY ASSIGN THEM
    const goodChunks = results
      .filter((r) => r.score >= MIN_SCORE)
      .slice(0, TOP_K);

    console.log(`\n✓ Filtered to ${goodChunks.length} chunks (MIN_SCORE=${MIN_SCORE})`);

    if (goodChunks.length === 0) {
      console.log("⚠ No chunks passed filtering");
      
      // Fallback: use top 5 anyway if all were filtered out
      const fallbackChunks = results.slice(0, 5);
      if (fallbackChunks.length > 0) {
        console.log("📌 Using top 5 chunks as fallback (scores were low)");
        const context = fallbackChunks
          .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
          .join("\n\n");

        console.log(`📝 Context length: ${context.length} chars`);
        const response = await chain.invoke({ question, context });
        console.log("RESPONSE",response);
        return extractAnswer(response);
      }

      return "I don't have enough relevant information to answer your question.";
    }

    // 4. Build context string
    const context = goodChunks
      .map((c, i) => `[${i + 1}] ${c.content.trim()}`)
      .join("\n\n");

    console.log(`📝 Context length: ${context.length} chars`);
    console.log(`Context preview:\n${context.substring(0, 200)}...\n`);

    // 5. Run the chain and extract answer
    console.log("🤖 Sending to LLM...");
    const response = await chain.invoke({ question, context });

    console.log("✓ LLM response received");
    const answer = extractAnswer(response);
    console.log(`Answer: ${answer.substring(0, 100)}...\n`);

    return answer;

  } catch (error: any) {
    console.error("❌ RAG ask failed:", error.message);
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