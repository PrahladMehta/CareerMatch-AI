import {pinecone} from "../utils/pinecone";

async function initPinecone() {
  const indexName = "rag-index";

  const exists = await pinecone.listIndexes();

  // If index does not exist, create one
  if (!exists.indexes?.some((i) => i.name === indexName)) {
    console.log("Creating index...");

    await pinecone.createIndex({
      name: indexName,
      dimension: 1536,
      metric: "cosine",
      spec: {
        serverless: { cloud: "aws", region: "us-east-1" }
      }
    });

    console.log("Index created!");
  }

  return pinecone.Index(indexName);
}

export default initPinecone;