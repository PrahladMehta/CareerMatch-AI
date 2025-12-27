import { Redis } from "@upstash/redis";
import { pinecone } from "../utils/pinecone.js";
import { OpenAIEmbeddings } from "@langchain/openai";
import { v4 as uuid } from "uuid";

const redis = Redis.fromEnv();

const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY!,
  modelName: "text-embedding-3-small",
});

const INDEX_NAME = "rag-index";
const QUERY_CACHE_NAMESPACE = "query-cache";
const SIMILARITY_THRESHOLD = 0.85; // Minimum similarity score to consider a cache hit

interface CachedResponse {
  answer: string;
  citedChunks: any[];
  source: "rag" | "web" | "job" | "combined" | "error";
  conversationId: string;
}

interface QueryCacheMetadata {
  query: string;
  redisKey: string;
  createdAt: string;
  userId?: string;
}

export const cache = {
  set: async (key: string, value: any) => {
    await redis.set(key, value);
  },
  get: async (key: string) => {
    return await redis.get(key);
  },
  delete: async (key: string) => {
    await redis.del(key);
  },

  /**
   * Store a query and its response in semantic cache
   * 1. Generate embedding for the query
   * 2. Store response in Redis
   * 3. Store query embedding in Pinecone with Redis key in metadata
   */
  storeQueryResponse: async (
    query: string,
    response: CachedResponse,
    userId?: string
  ): Promise<void> => {
    try {
      // 1. Generate embedding for the query
      const queryEmbedding = await embeddings.embedQuery(query);

      // 2. Generate unique Redis key
      const redisKey = `query-cache:${uuid()}`;

      // 3. Store response in Redis
      await redis.set(redisKey, JSON.stringify(response));

      // 4. Store query embedding in Pinecone with metadata
      const index = pinecone.Index(INDEX_NAME);
      const vectorId = `query-${uuid()}`;

      const metadata: QueryCacheMetadata = {
        query: query,
        redisKey: redisKey,
        createdAt: new Date().toISOString(),
        userId: userId,
      };

      await index.namespace(QUERY_CACHE_NAMESPACE).upsert([
        {
          id: vectorId,
          values: queryEmbedding,
          metadata: metadata as any,
        },
      ]);

      console.log(
        `✓ Cached query: "${query.substring(0, 50)}..." with key: ${redisKey}`
      );
    } catch (error: any) {
      console.error("Failed to store query in cache:", error.message);
      // Don't throw - caching failure shouldn't break the main flow
    }
  },

  /**
   * Check if a similar query exists in cache
   * 1. Generate embedding for the query
   * 2. Query Pinecone for similar queries
   * 3. If found with high similarity, fetch response from Redis
   * 4. Return cached response or null
   */
  getCachedResponse: async (
    query: string,
    userId?: string
  ): Promise<CachedResponse | null> => {
    try {
      // 1. Generate embedding for the query
      const queryEmbedding = await embeddings.embedQuery(query);

      // 2. Query Pinecone for similar queries
      const index = pinecone.Index(INDEX_NAME);

      // Build filter - optionally filter by userId if provided
      const filter: any = {};
      if (userId) {
        filter.userId = userId;
      }

      const queryResponse = await index.namespace(QUERY_CACHE_NAMESPACE).query({
        vector: queryEmbedding,
        topK: 1, // Only get the most similar query
        includeMetadata: true,
        includeValues: false,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
      });

      // 3. Check if we found a similar query with high similarity
      if (
        queryResponse.matches &&
        queryResponse.matches.length > 0 &&
        queryResponse.matches[0].score &&
        queryResponse.matches[0].score >= SIMILARITY_THRESHOLD
      ) {
        const match = queryResponse.matches[0];
        const metadata = match.metadata as unknown as QueryCacheMetadata;

        if (metadata.redisKey) {
          // 4. Fetch response from Redis
          const cachedData = await redis.get(metadata.redisKey);

          if (cachedData) {
            const response = JSON.parse(cachedData as string) as CachedResponse;
            console.log(
              `✓ Cache hit for query: "${query.substring(
                0,
                50
              )}..." (similarity: ${match.score?.toFixed(3)})`
            );
            return response;
          } else {
            console.log(
              `⚠ Cache key found but Redis data missing: ${metadata.redisKey}`
            );
          }
        }
      } else if (queryResponse.matches && queryResponse.matches.length > 0) {
        console.log(
          `Cache miss - similarity too low: ${queryResponse.matches[0].score?.toFixed(
            3
          )} < ${SIMILARITY_THRESHOLD}`
        );
      }

      return null;
    } catch (error: any) {
      console.error("Failed to check cache:", error.message);
      // Return null on error - don't break the main flow
      return null;
    }
  },
};
