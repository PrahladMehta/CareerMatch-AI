// src/services/insertVector.service.ts
import initPinecone from "./initPinecone.service";

interface UpsertMetadata {
  chunkIndex: number;
  chunkContent: string;
  fileName: string;
  createdAt: string;
  userId: string;
  resumeId: string;
  section: string;
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
    const index = await initPinecone();

    // Log what we're about to insert
    console.log(`  Upserting: ${id} (${metadata.chunkContent.length} chars)`);

    // Prepare metadata
    const cleanMetadata = {
      chunkIndex: metadata.chunkIndex,
      chunkContent: metadata.chunkContent,
      documentId: metadata.fileName || "unknown",
      createdAt: metadata.createdAt || new Date().toISOString(),
      userId: metadata.userId,
      resumeId: metadata.resumeId,
      section: metadata.section || "other",
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
