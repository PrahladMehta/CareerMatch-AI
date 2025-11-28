// src/services/createEmbeddings.service.ts

import { OpenAIEmbeddings } from "@langchain/openai";
import { SentenceSplitter } from "llamaindex";
import dotenv from "dotenv";
import upsertVector from "./insertVector.service";
dotenv.config();

// Types
interface ChunkEmbedding {
  chunk: string;
  embedding: number[];
  index: number;
}

interface Metadata {
  chunkIndex: number;
  chunkContent: string;
  documentId: string;
  createdAt: string;
}

// Initialize embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small",
});

/**
 * Split text using LlamaIndex SentenceSplitter
 * Maintains semantic coherence by splitting at sentence boundaries
 */
function splitTextWithLlamaIndex(
  text: string,
  chunkSize = 1024,
  chunkOverlap = 20
): string[] {
  const splitter = new SentenceSplitter({
    chunkSize,
    chunkOverlap,
  });

  return splitter.splitText(text);
}

export async function createChunkedEmbeddings(
  text: string
): Promise<ChunkEmbedding[]> {
  try {
    if (!text?.trim()) {
      throw new Error("Text cannot be empty");
    }

    // Use LlamaIndex SentenceSplitter
    console.log("Using LlamaIndex SentenceSplitter...");
    const chunks = splitTextWithLlamaIndex(text);

    // Filter out empty or very small chunks
    const filteredChunks = chunks.filter((c) => c.trim().length > 50);

    console.log(`✓ Created ${filteredChunks.length} chunks`);
    console.log(
      `Chunk sizes: min=${Math.min(...filteredChunks.map((c) => c.length))}, max=${Math.max(...filteredChunks.map((c) => c.length))}`
    );

    const chunksWithEmbeddings: ChunkEmbedding[] = [];

    // Embed chunks with batch processing to avoid rate limits
    for (let i = 0; i < filteredChunks.length; i++) {
      try {
        const embedding = await embeddings.embedQuery(filteredChunks[i]);
        chunksWithEmbeddings.push({
          chunk: filteredChunks[i],
          embedding,
          index: i,
        });

        // Log progress every 5 chunks
        if ((i + 1) % 5 === 0) {
          console.log(`  Embedded ${i + 1}/${filteredChunks.length} chunks...`);
        }
      } catch (err: any) {
        console.error(`Failed to embed chunk ${i}:`, err.message);
        // Continue with next chunk instead of failing completely
      }
    }

    console.log(`✓ Successfully embedded ${chunksWithEmbeddings.length} chunks`);
    return chunksWithEmbeddings;
  } catch (error: any) {
    console.error("Embedding error:", error);
    throw new Error(`Failed to create embeddings: ${error.message}`);
  }
}

export async function uploadChunksToPinecone(
  text: string,
  documentId: string
): Promise<void> {
  try {
    console.log(`Starting chunk creation and upload for document: ${documentId}`);

    const chunksWithEmbeddings = await createChunkedEmbeddings(text);

    if (chunksWithEmbeddings.length === 0) {
      throw new Error("No chunks were created from the document");
    }

    console.log(
      `Uploading ${chunksWithEmbeddings.length} chunks to Pinecone...`
    );

    for (const item of chunksWithEmbeddings) {
      const id = `${documentId}_chunk_${item.index}`;

      const metadata: Metadata = {
        chunkIndex: item.index,
        chunkContent: item.chunk,
        documentId,
        createdAt: new Date().toISOString(),
      };

      try {
        await upsertVector(id, item.embedding, metadata);
        // Log every 10 uploads
        if ((item.index + 1) % 10 === 0) {
          console.log(`  Uploaded ${item.index + 1} chunks to Pinecone...`);
        }
      } catch (err: any) {
        console.error(`Failed to upload chunk ${item.index}:`, err.message);
      }
    }

    console.log(
      `✓ All ${chunksWithEmbeddings.length} chunks uploaded to Pinecone successfully!`
    );
  } catch (error: any) {
    console.error("Error uploading chunks to Pinecone:", error);
    throw new Error(`Failed to upload chunks: ${error.message}`);
  }
}