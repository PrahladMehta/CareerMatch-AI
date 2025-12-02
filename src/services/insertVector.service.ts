// src/services/insertVector.service.ts

import { use } from "../routes/CreateEmbedding";
import { pinecone } from "../utils/pinecone";
import initPinecone from "./initPinecone.service";
import {v4 as uuid} from "uuid"

interface UpsertMetadata {
  chunkIndex: number;
  chunkContent: string;
  documentId: string;
  createdAt: string;
  userId: string;
  resumeId: string;
}

const INDEX_NAME = "rag-index";

async function upsertVector(
  id:string,
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
    const index = await initPinecone();

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
      userId: metadata.userId,
      resumeId: metadata.resumeId
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