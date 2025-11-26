// src/utils/initPinecone.ts

import { pinecone } from "../utils/pinecone.js";

const INDEX_NAME = "rag-index";

async function initPinecone() {
  try {
    console.log("Checking Pinecone indexes...");

    const { indexes = [] } = await pinecone.listIndexes();
    const indexExists = indexes.some((idx) => idx.name === INDEX_NAME);

    // 1. Create index only if it doesn't exist
    if (!indexExists) {
      console.log(`Creating index "${INDEX_NAME}"...`);
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

      // Wait until the index is ready (new v0.8+ API)
      console.log("Waiting for index to become ready...");
      const index = pinecone.Index(INDEX_NAME);
      while (true) {
        const stats = await index.describeIndexStats();
        // Correct way: check readiness via the index description (not stats.status)
        const description = await pinecone.describeIndex(INDEX_NAME);
        if (description.status?.ready) {
          console.log("Index is ready!");
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } else {
      console.log(`Index "${INDEX_NAME}" already exists. Reusing it.`);
    }

    // 2. Get the index instance
    const index = pinecone.Index(INDEX_NAME);

    // 3. Clean all vectors (fast & safe)
    console.log("Cleaning all existing vectors...");
    await index.namespace("").deleteAll(); // Deletes everything in default namespace
    // Alternative: await index.deleteAll(); // if you never use namespaces

    console.log("Index cleaned and ready for new embeddings!");

    return index;

  } catch (error: any) {
    console.error("Pinecone initialization failed:", error.message);
    throw error;
  }
}

export default initPinecone;