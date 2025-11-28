// src/utils/initPinecone.ts

import { pinecone } from "../utils/pinecone.js";

const INDEX_NAME = "rag-index";
const MAX_RETRIES = 15;
const RETRY_DELAY = 2000; // 2 seconds

async function waitForIndexReady(maxRetries = MAX_RETRIES) {
  console.log("Waiting for index to be ready...");
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const description = await pinecone.describeIndex(INDEX_NAME);
      
      if (description.status?.ready) {
        console.log("✓ Index is now ready!");
        return true;
      }
      
      console.log(
        `Attempt ${i + 1}/${maxRetries}: Index state = ${description.status?.state}. Waiting...`
      );
    } catch (err: any) {
      console.log(`Attempt ${i + 1}/${maxRetries}: Still initializing...`);
    }

    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }

  throw new Error(
    `Index "${INDEX_NAME}" did not become ready after ${(maxRetries * RETRY_DELAY) / 1000}s`
  );
}

async function initPinecone() {
  try {
    console.log("Checking Pinecone indexes...");

    const { indexes = [] } = await pinecone.listIndexes();
    const indexExists = indexes.some((idx) => idx.name === INDEX_NAME);
    let isNewIndex = false;

    // 1. Create index only if it doesn't exist
    if (!indexExists) {
      console.log(`Creating new index "${INDEX_NAME}"...`);
      isNewIndex = true;
      
      await pinecone.createIndex({
        name: INDEX_NAME,
        dimension: 1536,
        metric: "cosine",
        spec: {
          serverless: {
            cloud: "aws",
            region: "us-east-1",
          },
        },
      });

      console.log("Index creation initiated. Waiting for full initialization...");
      await waitForIndexReady();
    } else {
      console.log(`Index "${INDEX_NAME}" already exists. Reusing it.`);
    }

    // 2. Get the index instance
    const index = pinecone.Index(INDEX_NAME);

    // 3. Check index stats
    console.log("Checking index stats...");
    try {
      const stats = await index.describeIndexStats();
      const vectorCount = stats.totalRecordCount || 0;
      console.log(`Index contains ${vectorCount} vectors`);

      // 4. ONLY delete vectors if the index already had data AND is not brand new
      if (vectorCount > 0 && !isNewIndex) {
        console.log("Deleting existing vectors...");
        await index.deleteAll();
        console.log("✓ Vectors deleted");
      } else if (isNewIndex) {
        console.log("✓ New index is empty, no deletion needed");
      }
    } catch (err: any) {
      console.warn("⚠ Could not check/delete index stats:", err.message);
      console.warn("Proceeding anyway - the index may still be initializing");
    }

    console.log("✓ Pinecone index ready for embeddings!");
    return index;

  } catch (error: any) {
    console.error("❌ Pinecone initialization failed:", error.message);
    throw error;
  }
}

export default initPinecone;