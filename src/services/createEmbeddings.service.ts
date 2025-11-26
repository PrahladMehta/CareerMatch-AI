import { OpenAIEmbeddings } from "@langchain/openai";
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

// Custom text splitter
function splitTextCustom(
  text: string,
  chunkSize = 1000,
  chunkOverlap = 200
): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// Initialize embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small",
});

export async function createChunkedEmbeddings(
  text: string
): Promise<ChunkEmbedding[]> {
  try {
    if (!text?.trim()) {
      throw new Error("Text cannot be empty");
    }

    // Use custom splitter
    const chunks = splitTextCustom(text);
    console.log(`Created ${chunks.length} chunks`);

    const chunksWithEmbeddings: ChunkEmbedding[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embeddings.embedQuery(chunks[i]);
      chunksWithEmbeddings.push({
        chunk: chunks[i],
        embedding,
        index: i,
      });
    }

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
    console.log("Starting chunk creation and upload...");

    const chunksWithEmbeddings = await createChunkedEmbeddings(text);
    console.log(
      `Successfully created ${chunksWithEmbeddings.length} embeddings`
    );

    for (const item of chunksWithEmbeddings) {
      const id = `${documentId}_chunk_${item.index}`;

      const metadata: Metadata = {
        chunkIndex: item.index,
        chunkContent: item.chunk,
        documentId,
        createdAt: new Date().toISOString(),
      };

      await upsertVector(id, item.embedding, metadata);
      console.log(`Uploaded chunk ${item.index} (ID: ${id})`);
    }

    console.log("All chunks uploaded to Pinecone successfully!");
  } catch (error: any) {
    console.error("Error uploading chunks to Pinecone:", error);
    throw new Error(`Failed to upload chunks: ${error.message}`);
  }
}
    
