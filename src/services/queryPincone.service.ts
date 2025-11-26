// src/utils/queryPinecone.ts

import { pinecone } from "../utils/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY!,
  modelName: "text-embedding-3-small",
});

const INDEX_NAME = "rag-index";
const TOP_K = 5; // Number of most relevant chunks to return

/**
 * Query your Pinecone RAG index
 * @param queryText - The user's natural language question
 * @param options - Optional: topK, namespace, filter
 * @returns Array of matched chunks + similarity scores
 */
export async function queryRAG(
  queryText: string,
  options?: {
    topK?: number;
    namespace?: string;        // e.g. "doc_123" if you use per-document namespaces
    filter?: Record<string, any>; // metadata filter
  }
) {
  if (!queryText?.trim()) {
    throw new Error("Query text is required");
  }

  const index = pinecone.Index(INDEX_NAME);

  // 1. Embed the user's question
  const queryEmbedding = await embeddings.embedQuery(queryText);

  // 2. Query Pinecone
  const queryResponse = await index.namespace(options?.namespace || "").query({
    vector: queryEmbedding,
    topK: options?.topK || TOP_K,
    includeMetadata: true,   // So we get chunkContent back
    includeValues: false,    // We don't need the raw vectors back
    filter: options?.filter,
  });

  // 3. Extract results
  const results = queryResponse.matches?.map((match) => ({
    id: match.id,
    score: match.score ?? 0,
    content: (match.metadata as any)?.chunkContent as string || "[No content]",
    chunkIndex: (match.metadata as any)?.chunkIndex as number,
    documentId: (match.metadata as any)?.documentId as string,
    createdAt: (match.metadata as any)?.createdAt as string,
  })) ?? [];

  console.log(`Query: "${queryText}" → Found ${results.length} matches`);

  return results; 
}