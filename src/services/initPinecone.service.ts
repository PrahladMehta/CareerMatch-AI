// src/utils/initPinecone.ts

import { pinecone } from "../utils/pinecone.js";

const INDEX_NAME = "rag-index";
const MAX_RETRIES = 20;
const RETRY_DELAY = 3000; // 3 seconds

let indexInstance: any = null;
let isInitialized = false;

async function waitForIndexReady(maxRetries = MAX_RETRIES) {
  console.log("⏳ Waiting for index status to be ready...");

  for (let i = 0; i < maxRetries; i++) {
    try {
      const description = await pinecone.describeIndex(INDEX_NAME);

      if (description.status?.ready) {
        console.log("✓ Index status is ready!");
        return true;
      }

      console.log(
        `  Attempt ${i + 1}/${maxRetries}: Status = ${description.status?.state}. Waiting...`
      );
    } catch (err: any) {
      console.log(`  Attempt ${i + 1}/${maxRetries}: Still initializing...`);
    }

    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }

  throw new Error(
    `Index "${INDEX_NAME}" did not become ready after ${(maxRetries * RETRY_DELAY) / 1000}s`
  );
}

async function waitForIndexAccessible(maxRetries = 10) {
  console.log("⏳ Waiting for index endpoint to be accessible...");

  for (let i = 0; i < maxRetries; i++) {
    try {
      const index = pinecone.Index(INDEX_NAME);
      const stats = await index.describeIndexStats();
      console.log(`✓ Index endpoint is accessible! Contains ${stats.totalRecordCount || 0} vectors`);
      return index;
    } catch (err: any) {
      if (err.status === 404 || err.message?.includes("404")) {
        console.log(
          `  Attempt ${i + 1}/${maxRetries}: Endpoint not ready yet. Waiting...`
        );
      } else {
        console.log(`  Attempt ${i + 1}/${maxRetries}: ${err.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(`Index endpoint never became accessible after ${maxRetries * 2}s`);
}

async function initPinecone() {
  if (isInitialized && indexInstance) {
    console.log("✓ Pinecone already initialized, reusing...");
    return indexInstance;
  }

  try {
    console.log("\n========== INITIALIZING PINECONE ==========\n");

    // 1. Check if index already exists
    console.log("🔍 Checking for existing indexes...");
    const { indexes = [] } = await pinecone.listIndexes();
    console.log(`Found ${indexes.length} index(es) in Pinecone\n`);

    if (indexes.length > 0) {
      indexes.forEach((idx) => {
        console.log(`  - ${idx.name} (${idx.host})`);
      });
      console.log();
    }

    const indexExists = indexes.some((idx) => idx.name === INDEX_NAME);

    // 2. If index exists, use it
    if (indexExists) {
      console.log(`\n✅ Index "${INDEX_NAME}" FOUND! Using existing index.\n`);

      // Wait for endpoint to be accessible
      try {
        indexInstance = await waitForIndexAccessible();
      } catch (err: any) {
        console.log(
          "⚠ Could not verify endpoint, trying direct instantiation..."
        );
        indexInstance = pinecone.Index(INDEX_NAME);
      }
    } else {
      // 3. If index doesn't exist, create it
      console.log(
        `\n❌ Index "${INDEX_NAME}" NOT FOUND. Creating new index...\n`
      );

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

      console.log("✓ Index creation request sent to Pinecone");
      console.log(
        "⏳ Waiting for index to fully initialize (this may take 1-2 minutes)...\n"
      );

      // Wait for status to be ready
      await waitForIndexReady();

      // Wait for endpoint to be accessible
      console.log();
      indexInstance = await waitForIndexAccessible();
    }

    // 4. Verify and log final state
    console.log("\n📊 Verifying index state...");
    try {
      const stats = await indexInstance.describeIndexStats();
      const vectorCount = stats.totalRecordCount || 0;
      console.log(`✓ Index ready with ${vectorCount} vectors`);
    } catch (err: any) {
      console.warn("⚠ Could not fetch stats:", err.message);
    }

    isInitialized = true;
    console.log("\n✓✓✓ Pinecone initialized successfully! ✓✓✓");
    console.log("========================================\n");

    return indexInstance;
  } catch (error: any) {
    console.error("❌ Pinecone initialization FAILED:", error.message);
    console.error(error);
    throw error;
  }
}

export function getPineconeIndex() {
  if (!isInitialized || !indexInstance) {
    throw new Error(
      "❌ Pinecone index not initialized. Call initPinecone() first at app startup."
    );
  }
  return indexInstance;
}

export default initPinecone;