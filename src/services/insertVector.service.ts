// src/services/insertVector.service.ts

import { pinecone } from "../utils/pinecone";

interface UpsertMetadata {
  chunkIndex: number;
  chunkContent: string;
  documentId: string;
  createdAt: string;
}

const INDEX_NAME = "rag-index";

async function upsertVector(
  id: string,
  values: number[],
  metadata: UpsertMetadata
) {
  try {
    // Validate inputs
    if (!id || !values || values.length !== 1536) {
      throw new Error(
        `Invalid input: id=${id}, vector_dim=${values.length} (expected 1536)`
      );
    }

    if (!metadata.chunkContent || metadata.chunkContent.trim().length === 0) {
      throw new Error("chunkContent cannot be empty");
    }

    // ✅ DON'T call initPinecone() here - it calls deleteAll()
    // ✅ Just get the index directly
    const index = pinecone.Index(INDEX_NAME);

    // Log what we're about to insert
    console.log(
      `  Upserting: ${id} (${metadata.chunkContent.length} chars)`
    );

    // Prepare metadata
    const cleanMetadata = {
      chunkIndex: metadata.chunkIndex,
      chunkContent: metadata.chunkContent,
      documentId: metadata.documentId || "unknown",
      createdAt: metadata.createdAt || new Date().toISOString(),
    };

    // Upsert to Pinecone
    await index.upsert([
      {
        id,
        values,
        metadata: cleanMetadata,
      },
    ]);

    console.log(`    ✓ Upserted successfully`);
  } catch (error: any) {
    console.error(`    ❌ Failed to upsert ${id}:`, error.message);
    throw error;
  }
}

export default upsertVector;